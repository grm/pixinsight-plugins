# Astrogrm Master Mixer

Astrogrm Master Mixer combines two compatible monochrome master images into a new image, weighting each input by its estimated noise. It is available in PixInsight under **Script > Astrogrm > Master Mixer**.

## Assumptions

Version 0.1 accepts exactly two different open main views. Both must be single-channel monochrome images with identical width and height. The images are assumed to be registered, linear, and of the same target and filter; the script does not verify those three scientific assumptions.

Master Mixer does not currently perform photometric or linear normalization. Input masters should be on comparable linear intensity scales. For masters generated independently, especially with different exposure durations or different imaging systems, applying LinearFit to a common reference is recommended before mixing.

The estimator always operates on the entire image. Existing image selections are saved before analysis and restored afterward, including when estimation fails.

## Absolute and scaled noise

For each master, the script reports two values:

- **Absolute sigma** is the sigma returned directly by `Image.noiseMRS()` or, when necessary, `Image.noiseKSigma()`.
- **Scaled sigma** is `absoluteSigma / image.Sn()`, where `Sn()` is PixInsight's robust scale estimator. Scaling makes the weighting respond to noise relative to the image's robust signal scale, rather than only to its absolute normalized sample values.

The script rejects an image when `Sn()` is zero or insignificant.

The analysis also reports `Sn(B) / Sn(A)`. If the larger `Sn` is more than 1.20 times the smaller value, the script displays a non-blocking warning recommending LinearFit. This diagnostic does not change the weights or prevent creation of the mix.

## MRS estimator and fallback

Noise estimation follows PixInsight's NoiseEvaluation convergence policy. It begins with four multiresolution-support (MRS) layers. An estimate is accepted only when at least 1% of the selected pixels are classified as noise pixels. If necessary, the script retries with three and then two layers.

If none of those MRS estimates meets the threshold, the script falls back to `Image.noiseKSigma()`. In this case the estimator is reported as `k-sigma` and the MRS-layers column shows an em dash because no MRS result was used.

## Weighting

Version 0.1 uses inverse variance based on scaled sigma:

```text
rawWeightA = 1 / scaledSigmaA^2
rawWeightB = 1 / scaledSigmaB^2

weightA = rawWeightA / (rawWeightA + rawWeightB)
weightB = rawWeightB / (rawWeightA + rawWeightB)
```

The normalized weights sum to one. **Analyze** displays both noise measurements, the noise-pixel percentage, MRS layers, fallback status, and normalized weights before **Create Mix** is enabled.

**Create Mix** makes a new 32-bit floating-point monochrome image whose default identifier is `AstrogrmMix`. Native PJSR `Image` arithmetic evaluates `weightA*A + weightB*B`; no rescaling, truncation, or post-mix normalization is performed. If that identifier already exists, PixInsight may assign a unique variant.

## Current limitations

- Only two single-channel monochrome main views are supported.
- Registration, linearity, target identity, and filter identity are assumed rather than checked.
- No local normalization or gradient matching is performed.
- No masks, rejection, outlier removal, or per-region weighting are provided.
- FITS keywords and, where present, the astrometric solution are propagated from Master A. Image-resolution settings and ICC profiles are not copied because no confirmed direct `ImageWindow` assignment API was found for them. Processing history is not copied.

## Why this is not HDRComposition

HDRComposition combines exposures with different dynamic ranges, selecting useful, unsaturated image regions to extend dynamic range. Master Mixer instead assumes two comparable images of the same target and filter and applies one global, noise-derived weight to each complete image. It neither detects saturated regions nor constructs a high-dynamic-range composite.

## Runtime validation

The following development tests validate the current implementation; they are not a general mathematical proof that this is the optimal weighting scheme for all astrophotographic data.

- **Identical master test:** identical inputs produced 50/50 weights.
- **0.5 scale test:** multiplying one input by 0.5 scaled both its absolute sigma and `Sn` by 0.5. Its scaled sigma was unchanged and the weights remained 50/50.
- **Native mix test:** `0.5*A + 0.5*(0.5*A)` matched `0.75*A`, with a maximum float32 residual of approximately `2.98e-8`.
- **Real exposure test, before linear normalization:** H_1200 had scaled sigma `0.142257` and weight `83.99%`; H_300 had scaled sigma `0.325772` and weight `16.01%`; `Sn(B)/Sn(A) = 0.286833`.
- **Real exposure test, after LinearFit to a common reference:** H_1200 had scaled sigma `0.1422570` and weight `83.99%`; H_300 had scaled sigma `0.3257714` and weight `16.01%`; `Sn(B)/Sn(A) = 0.9715744`.

For this real dataset, scaled-noise weighting was effectively invariant to the applied linear intensity-scale correction.
