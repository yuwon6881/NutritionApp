using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;

// Builds api/Services/Food/Data/usda-generic.json.gz from the USDA FoodData Central bulk JSON
// downloads (public domain, CC0). Run from the repository root:
//   dotnet run --project tools/usda-import -- [--input <dir with the zips>] [--out <path>]
// Missing nutrients stay absent; foods without energy are dropped rather than guessed.

var sources=new[]
{
    // Priority order: when two datasets describe the same food, the first one wins.
    new Source("Foundation","FoodData_Central_foundation_food_json_2026-04-30.zip","2026-04-30"),
    new Source("SR Legacy","FoodData_Central_sr_legacy_food_json_2018-04.zip","2018-04"),
    new Source("Survey (FNDDS)","FoodData_Central_survey_food_json_2024-10-31.zip","2024-10-31"),
};
var input=Option("--input")??Path.Combine(Path.GetTempPath(),"usda-import");
var output=Option("--out")??Path.Combine(RepositoryRoot(),"api","Services","Food","Data","usda-generic.json.gz");
Directory.CreateDirectory(input);

var foods=new List<ImportedFood>();
var seen=new HashSet<string>(StringComparer.Ordinal);
using var http=new HttpClient{Timeout=TimeSpan.FromMinutes(10)};
foreach(var source in sources)
{
    var zip=Path.Combine(input,source.File);
    if(!File.Exists(zip))
    {
        Console.WriteLine($"Downloading {source.File}");
        await using var download=await http.GetStreamAsync("https://fdc.nal.usda.gov/fdc-datasets/"+source.File);
        await using var file=File.Create(zip);
        await download.CopyToAsync(file);
    }
    using var archive=ZipFile.OpenRead(zip);
    var entry=archive.Entries.Single(item=>item.FullName.EndsWith(".json",StringComparison.OrdinalIgnoreCase));
    await using var stream=entry.Open();
    using var json=await JsonDocument.ParseAsync(stream);
    var list=json.RootElement.EnumerateObject().Single().Value;
    var before=foods.Count;
    foreach(var food in list.EnumerateArray())
        if(Read(food,source.DataType) is { } imported&&seen.Add(Key(imported.Name)))foods.Add(imported);
    Console.WriteLine($"{source.DataType}: {foods.Count-before} foods");
}

foods.Sort((left,right)=>string.Compare(left.Name,right.Name,StringComparison.OrdinalIgnoreCase));
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
await using(var file=File.Create(output))
await using(var gzip=new GZipStream(file,CompressionLevel.SmallestSize))
await using(var writer=new Utf8JsonWriter(gzip))
{
    writer.WriteStartObject();
    writer.WriteString("source","USDA FoodData Central");
    writer.WriteStartObject("releases");
    foreach(var source in sources)writer.WriteString(source.DataType,source.Release);
    writer.WriteEndObject();
    writer.WriteStartArray("foods");
    foreach(var food in foods)
    {
        writer.WriteStartObject();
        writer.WriteNumber("id",food.Id);
        writer.WriteString("n",food.Name);
        writer.WriteNumber("k",food.Calories);
        Optional(writer,"p",food.Protein);
        Optional(writer,"f",food.Fat);
        Optional(writer,"c",food.Carbs);
        Optional(writer,"fi",food.Fiber);
        if(food.Portions.Count>0)
        {
            writer.WriteStartArray("s");
            foreach(var (label,grams) in food.Portions)
            {
                writer.WriteStartArray();
                writer.WriteStringValue(label);
                writer.WriteNumberValue(grams);
                writer.WriteEndArray();
            }
            writer.WriteEndArray();
        }
        writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
}
Console.WriteLine($"Wrote {foods.Count} foods to {output} ({new FileInfo(output).Length/1024} KiB)");

static ImportedFood? Read(JsonElement food,string dataType)
{
    if(food.ValueKind!=JsonValueKind.Object||!food.TryGetProperty("foodNutrients",out var list)||list.ValueKind!=JsonValueKind.Array)return null;
    return ReadFood(food,list,dataType);
}

static ImportedFood? ReadFood(JsonElement food,JsonElement list,string dataType)
{
    var name=Clean(food.GetProperty("description").GetString()??"");
    if(name.Length is 0 or > 160)return null;
    var nutrients=new Dictionary<string,double>(StringComparer.Ordinal);
    foreach(var nutrient in list.EnumerateArray())
        if(nutrient.TryGetProperty("nutrient",out var info)&&info.TryGetProperty("number",out var number)&&nutrient.TryGetProperty("amount",out var amount)&&amount.TryGetDouble(out var value))
            nutrients.TryAdd(number.GetString()??"",value);
    double? Get(string number)=>nutrients.TryGetValue(number,out var value)&&double.IsFinite(value)&&value>=0?Math.Round(value,2):null;
    // Atwater-specific energy is the most accurate figure where present; 208 is the classic
    // kcal value and Atwater general the last resort. A food with none of them is dropped.
    var calories=Get("958")??Get("208")??Get("957");
    if(calories is null)return null;
    return new ImportedFood(food.GetProperty("fdcId").GetInt32(),name,calories.Value,Get("203"),Get("204"),Get("205"),Get("291"),Portions(food,dataType));
}

static IReadOnlyList<(string Label,double Grams)> Portions(JsonElement food,string dataType)
{
    var portions=new List<(string,double)>();
    var labels=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    if(!food.TryGetProperty("foodPortions",out var list))return portions;
    foreach(var portion in list.EnumerateArray().OrderBy(item=>item.TryGetProperty("sequenceNumber",out var sequence)&&sequence.TryGetInt32(out var value)?value:99))
    {
        if(!portion.TryGetProperty("gramWeight",out var weight)||!weight.TryGetDouble(out var grams)||grams is < .1 or > 10000)continue;
        if(PortionLabel(portion,dataType) is not { } label||!labels.Add(label))continue;
        portions.Add((label,Math.Round(grams,1)));
        if(portions.Count==8)break;
    }
    return portions;
}

static string? PortionLabel(JsonElement portion,string dataType)
{
    string raw;
    if(dataType=="Survey (FNDDS)")
    {
        raw=Text(portion,"portionDescription")??"";
        // "1 cup, dry, yields" weighs the cooked result of a dry measure, which reads as a cup of the food.
        if(raw.StartsWith("Quantity not specified",StringComparison.OrdinalIgnoreCase)||raw.StartsWith("Guideline",StringComparison.OrdinalIgnoreCase)||raw.Contains("yield",StringComparison.OrdinalIgnoreCase))return null;
    }
    else
    {
        var unit=portion.TryGetProperty("measureUnit",out var measure)?Text(measure,"name")??"":"";
        if(unit=="RACC")return null;
        if(unit=="undetermined")unit="";
        var amount=portion.TryGetProperty("amount",out var a)&&a.TryGetDouble(out var value)?value
            :portion.TryGetProperty("value",out var v)&&v.TryGetDouble(out value)?value:1;
        raw=string.Join(' ',new[]{amount.ToString("0.##",CultureInfo.InvariantCulture),unit,Text(portion,"modifier")??""}.Where(part=>part.Length>0));
    }
    // Labels are shown on a chip, so they must fit the app's 24-character portion limit. Drop the
    // parenthetical detail first, then anything after a comma; a label that still does not fit is
    // left out rather than cut mid-word.
    foreach(var candidate in new[]{Clean(raw),Clean(Regex.Replace(raw,@"\([^)]*\)","")),Clean(Regex.Replace(raw,@"\([^)]*\)","").Split(',')[0])})
        if(candidate.Length is > 0 and <= 24&&!Regex.IsMatch(candidate,@"^[\d.\s]+$"))return candidate;
    return null;
}

static string Clean(string value)=>Regex.Replace(value,@"\s+"," ").Trim().TrimEnd(',',';').Trim();

static string Key(string name)=>new(name.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

static string? Text(JsonElement element,string name)
    =>element.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String&&value.GetString()?.Trim() is {Length:>0} text?text:null;

static void Optional(Utf8JsonWriter writer,string name,double? value)
{
    if(value is { } number)writer.WriteNumber(name,number);
}

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

internal sealed record Source(string DataType,string File,string Release);
internal sealed record ImportedFood(int Id,string Name,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,IReadOnlyList<(string Label,double Grams)> Portions);
