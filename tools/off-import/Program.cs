using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Parquet;
using Parquet.Serialization;

// Builds api/Services/Food/Data/off-products.json.gz from the Open Food Facts Parquet export
// (ODbL; the generated file is a derivative database under the same licence). Run from the
// repository root:
//   dotnet run --project tools/off-import -- [--input <food.parquet>] [--out <path>] [--countries <tags>]
// The export is about 8 GB and is downloaded once to the input path. Only products sold in the
// chosen countries with a Latin-script name and calories are kept; missing nutrients stay absent.
// The default countries are Malaysia and Singapore plus the countries whose imports Malaysian
// supermarkets commonly stock.

const string ExportUrl="https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet";
var input=Option("--input")??Path.Combine(Path.GetTempPath(),"off-import","food.parquet");
var output=Option("--out")??Path.Combine(RepositoryRoot(),"api","Services","Food","Data","off-products.json.gz");
var countries=(Option("--countries")??"en:malaysia,en:singapore,en:thailand,en:south-korea,en:china,en:japan,en:indonesia,en:taiwan").Split(',',StringSplitOptions.RemoveEmptyEntries|StringSplitOptions.TrimEntries);

if(!File.Exists(input))
{
    Directory.CreateDirectory(Path.GetDirectoryName(input)!);
    Console.WriteLine($"Downloading {ExportUrl} to {input}");
    using var http=new HttpClient{Timeout=TimeSpan.FromHours(2)};
    await using var download=await http.GetStreamAsync(ExportUrl);
    await using var file=File.Create(input+".part");
    await download.CopyToAsync(file);
    file.Close();
    File.Move(input+".part",input);
}

var foods=new List<ImportedProduct>();
var seen=new HashSet<string>(StringComparer.Ordinal);
var skipped=new Dictionary<string,int>(StringComparer.Ordinal);
void Skip(string reason)=>skipped[reason]=skipped.GetValueOrDefault(reason)+1;

await using(var stream=File.OpenRead(input))
using(var reader=await ParquetReader.CreateAsync(stream))
{
    // Reading only the country tag column first skips the nested nutrient columns of the many row
    // groups that hold no product for the chosen countries.
    var tags=reader.Schema.GetDataFields().Single(field=>field.Path.ToString().StartsWith("countries_tags",StringComparison.Ordinal));
    var matching=0;
    for(var group=0;group<reader.RowGroupCount;group++)
    {
        using(var rows=reader.OpenRowGroupReader(group))
            if(!((string?[])(await rows.ReadColumnAsync(tags)).Data).Any(Wanted))continue;
        matching++;
        var products=new List<ProductRow>();
        await ParquetSerializer.DeserializeAsync(reader,group,products);
        foreach(var row in products)
        {
            if(row.Countries?.Any(Wanted)!=true)continue;
            if(Product.Read(row,out var reason) is not { } product) { Skip(reason); continue; }
            if(!seen.Add(product.Code)) { Skip("duplicate code"); continue; }
            foods.Add(product);
        }
    }
    Console.WriteLine($"{matching} of {reader.RowGroupCount} row groups hold products for {string.Join(", ",countries)}");
}

foods.Sort((left,right)=>string.Compare(left.Name,right.Name,StringComparison.OrdinalIgnoreCase));
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
await using(var file=File.Create(output))
await using(var gzip=new GZipStream(file,CompressionLevel.SmallestSize))
await using(var writer=new Utf8JsonWriter(gzip))
{
    writer.WriteStartObject();
    writer.WriteString("source","Open Food Facts");
    writer.WriteString("licence","ODbL 1.0");
    writer.WriteString("exported",File.GetLastWriteTimeUtc(input).ToString("yyyy-MM-dd",CultureInfo.InvariantCulture));
    writer.WriteStartArray("countries");
    foreach(var country in countries)writer.WriteStringValue(country);
    writer.WriteEndArray();
    writer.WriteStartArray("foods");
    foreach(var food in foods)Product.Write(writer,food);
    writer.WriteEndArray();
    writer.WriteEndObject();
}
foreach(var (reason,count) in skipped.OrderByDescending(item=>item.Value))Console.WriteLine($"Skipped {count}: {reason}");
Console.WriteLine($"Wrote {foods.Count} products ({foods.Count(food=>food.Measure=="ml")} per 100 ml, {foods.Count(food=>food.Serving is not null)} with a serving) to {output} ({new FileInfo(output).Length/1024} KiB)");

bool Wanted(string? tag)=>tag is not null&&countries.Contains(tag,StringComparer.Ordinal);

string? Option(string name)
{
    var index=Array.IndexOf(args,name);
    return index>=0&&index+1<args.Length?args[index+1]:null;
}

static string RepositoryRoot()
{
    for(var directory=new DirectoryInfo(Directory.GetCurrentDirectory());directory is not null;directory=directory.Parent)
        if(File.Exists(Path.Combine(directory.FullName,"NutritionApp.slnx")))return directory.FullName;
    throw new InvalidOperationException("Run from inside the NutritionApp repository or pass --out.");
}

/// <summary>
/// Mirrors the API's Open Food Facts parser (OpenFoodFactsParser) so a bundled row reads the same
/// as the product endpoint would. The export has no serving_quantity_unit, so a serving is kept only
/// when its label states the amount in the product's own measure.
/// </summary>
internal static partial class Product
{
    public static ImportedProduct? Read(ProductRow row,out string reason)
    {
        reason="";
        var code=row.Code?.Trim();
        if(string.IsNullOrEmpty(code)||code.Length>14||!code.All(char.IsAsciiDigit)) { reason="no usable barcode"; return null; }
        if(row.Obsolete==true) { reason="obsolete"; return null; }
        if(Name(row.ProductName) is not { } name) { reason="no name"; return null; }
        var nutrients=new Dictionary<string,double>(StringComparer.Ordinal);
        foreach(var nutrient in row.Nutriments??[])
            if(nutrient.Name is { } key&&nutrient.Per100 is { } value&&float.IsFinite(value))nutrients.TryAdd(key,Math.Round(value,2));
        double? Get(string key)=>nutrients.TryGetValue(key,out var value)?value:null;
        if(Get("energy-kcal") is not { } calories) { reason="no calories"; return null; }
        double?[] macros=[Get("proteins"),Get("fat"),Get("carbohydrates"),Get("fiber")];
        // A label cannot hold more than its own weight; such a record has a unit or entry error.
        if(calories is < 0 or > 900||macros.Any(value=>value is < 0 or > 100)||macros[..3].Sum(value=>value??0)>105) { reason="implausible nutrients"; return null; }
        var measure=Measure(row);
        return new ImportedProduct(code,name,Brand(row.Brands),calories,macros[0],macros[1],macros[2],macros[3],measure,Serving(row,measure));
    }

    public static void Write(Utf8JsonWriter writer,ImportedProduct food)
    {
        writer.WriteStartObject();
        writer.WriteString("code",food.Code);
        writer.WriteString("n",food.Name);
        if(food.Brand is not null)writer.WriteString("b",food.Brand);
        writer.WriteNumber("k",food.Calories);
        Optional(writer,"p",food.Protein);
        Optional(writer,"f",food.Fat);
        Optional(writer,"c",food.Carbs);
        Optional(writer,"fi",food.Fiber);
        if(food.Measure=="ml")writer.WriteString("m","ml");
        if(food.Serving is { } serving)
        {
            writer.WriteStartArray("s");
            writer.WriteStartArray();
            writer.WriteStringValue(serving.Label);
            writer.WriteNumberValue(serving.Amount);
            writer.WriteEndArray();
            writer.WriteEndArray();
        }
        writer.WriteEndObject();
    }

    /// <summary>
    /// The English name when there is one, otherwise the first Latin-script name. Search drops
    /// names in other scripts, so they are left out here rather than shipped unread.
    /// </summary>
    private static string? Name(List<LocalizedText>? names)
    {
        var candidates=(names??[])
            .OrderBy(name=>name.Lang=="en"?0:name.Lang=="main"?1:2)
            .Select(name=>Regex.Replace(name.Text??"",@"\s+"," ").Trim());
        return candidates.FirstOrDefault(name=>name.Length is >0 and <=160&&LatinOnly(name));
    }

    private static string? Brand(string? brands)=>brands?.Split(',')[0].Trim() is {Length:>0} brand&&LatinOnly(brand)?brand:null;

    /// <summary>A stricter subset of the API's FoodResults.HasOnlyLatinLetters: Latin letters only, at least one.</summary>
    private static bool LatinOnly(string text)
    {
        var letters=text.Where(char.IsLetter).ToArray();
        return letters.Length>0&&letters.All(IsLatin);
    }

    private static bool IsLatin(char letter)=>letter<0x250||letter is >='\u1E00' and <='\u1EFF';

    private static string Measure(ProductRow row)
    {
        if(LabelMeasure(row) is { } declared)return declared;
        if(Unit(row.ProductQuantityUnit) is { } unit)return unit;
        foreach(var text in new[]{row.ServingSize,row.Quantity})
            if(MetricAmount().Match(text??"") is {Success:true} match)return Unit(match.Groups["unit"].Value)!;
        return "g";
    }

    private static string? LabelMeasure(ProductRow row)
    {
        if(Number(row.ServingQuantity) is not { } amount)return null;
        var match=MetricAmount().Match(row.ServingSize??"");
        return match.Success&&Number(match.Groups["amount"].Value)==amount?Unit(match.Groups["unit"].Value):null;
    }

    private static Serving? Serving(ProductRow row,string measure)
    {
        if(Number(row.ServingQuantity) is not { } amount||amount is < .1 or > 10000||LabelMeasure(row)!=measure)return null;
        var label=Regex.Replace(row.ServingSize!,@"\s+"," ").Trim();
        var metricOnly=MetricOnlyLabel().IsMatch(label);
        // A serving of exactly 100 repeats the per-100 basis, as the API parser rules.
        if(metricOnly&&Math.Abs(amount-100)<.001)return null;
        // A label in another script ("1本(110ml)") would be unreadable on the portion chip.
        return new Serving(metricOnly||label.Any(letter=>char.IsLetter(letter)&&!IsLatin(letter))?"serving":label,amount);
    }

    private static string? Unit(string? unit)=>unit?.Trim().ToLowerInvariant() switch { "g"=>"g", "ml"=>"ml", _=>null };

    private static double? Number(string? text)
        =>double.TryParse(text?.Replace(',','.'),NumberStyles.Float,CultureInfo.InvariantCulture,out var value)&&double.IsFinite(value)?value:null;

    private static void Optional(Utf8JsonWriter writer,string name,double? value)
    {
        if(value is { } number)writer.WriteNumber(name,number);
    }

    [GeneratedRegex(@"(?<amount>\d+(?:[.,]\d+)?)\s*(?<unit>g|ml)\b",RegexOptions.IgnoreCase)]
    private static partial Regex MetricAmount();

    [GeneratedRegex(@"^\s*\d+(?:[.,]\d+)?\s*(?:g|ml)?\s*$",RegexOptions.IgnoreCase)]
    private static partial Regex MetricOnlyLabel();
}

internal sealed record Serving(string Label,double Amount);
internal sealed record ImportedProduct(string Code,string Name,string? Brand,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,string Measure,Serving? Serving);

internal sealed class ProductRow
{
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("product_name")] public List<LocalizedText>? ProductName { get; set; }
    [JsonPropertyName("brands")] public string? Brands { get; set; }
    [JsonPropertyName("countries_tags")] public List<string?>? Countries { get; set; }
    [JsonPropertyName("obsolete")] public bool? Obsolete { get; set; }
    [JsonPropertyName("nutriments")] public List<Nutriment>? Nutriments { get; set; }
    [JsonPropertyName("serving_size")] public string? ServingSize { get; set; }
    [JsonPropertyName("serving_quantity")] public string? ServingQuantity { get; set; }
    [JsonPropertyName("product_quantity_unit")] public string? ProductQuantityUnit { get; set; }
    [JsonPropertyName("quantity")] public string? Quantity { get; set; }
}

internal sealed class LocalizedText
{
    [JsonPropertyName("lang")] public string? Lang { get; set; }
    [JsonPropertyName("text")] public string? Text { get; set; }
}

internal sealed class Nutriment
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("100g")] public float? Per100 { get; set; }
}
