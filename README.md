# Astrogrm PixInsight Scripts

PixInsight scripts maintained by Astrogrm.

## Structure

- `src/scripts/Astrogrm/` — PixInsight JavaScript Runtime scripts.
- `docs/` — Supporting documentation and usage guides.

## Installation

Add the repository's `src/scripts` directory to PixInsight's script search paths, then use **Script > Feature Scripts** to rescan for scripts.

## Scripts

### Astrogrm > Master Mixer

Combines two registered, linear monochrome masters of the same target and filter into a new 32-bit floating-point image. The script estimates MRS noise, displays absolute and scaled noise measurements, and uses normalized inverse-variance weights based on scaled sigma before creating the mix.

See [Master Mixer documentation](docs/master-mixer.md) for assumptions, formulas, fallback behavior, and current limitations.
