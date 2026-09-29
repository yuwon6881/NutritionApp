namespace Nutrition.Api.Domain;

/// Deterministic tape-measure references offered to the AI estimate as a cross-check.
public static class BodyFatFormulas
{
    /// U.S. Navy circumference equation (metric form). Women also need hips. Any missing
    /// input, or a waist that does not exceed the neck, leaves the reference unknown.
    public static double? Navy(string? sex,double? heightCm,double? neckCm,double? waistCm,double? hipsCm)
    {
        if(heightCm is not {} height||neckCm is not {} neck||waistCm is not {} waist)return null;
        double percent;
        if(sex=="male")
        {
            if(waist<=neck)return null;
            percent=495/(1.0324-0.19077*Math.Log10(waist-neck)+0.15456*Math.Log10(height))-450;
        }
        else if(sex=="female")
        {
            if(hipsCm is not {} hips||waist+hips<=neck)return null;
            percent=495/(1.29579-0.35004*Math.Log10(waist+hips-neck)+0.22100*Math.Log10(height))-450;
        }
        else return null;
        // Outside this band the equation is extrapolating rather than estimating.
        return double.IsFinite(percent)&&percent is >=2 and <=75?Math.Round(percent,1):null;
    }
}
