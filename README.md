# Astrogrm PixInsight Scripts

PixInsight scripts maintained by Astrogrm.

## Structure

- `src/scripts/Astrogrm/` — PixInsight JavaScript Runtime scripts.
- `docs/` — Supporting documentation and usage guides.
- `updates/` — Generated PixInsight update-repository artifacts published by GitHub Pages.

## Installation

The official Astrogrm PixInsight repository is published with GitHub Pages at:

```text
https://grm.github.io/pixinsight-plugins/
```

In PixInsight, open **Resources > Updates > Manage Repositories**, add the URL above, then run **Resources > Updates > Check for Updates**.

For local development, add this repository's `src/scripts` directory to PixInsight's script search paths and use **Script > Feature Scripts** to rescan.

## Scripts

### Astrogrm > Master Mixer

Combines two registered, linear monochrome masters of the same target and filter into a new 32-bit floating-point image. The script estimates MRS noise, displays absolute and scaled noise measurements, and uses normalized inverse-variance weights based on scaled sigma before creating the mix.

See [Master Mixer documentation](docs/master-mixer.md) for assumptions, formulas, fallback behavior, and current limitations.

### Astrogrm > BlinkCull

Blinks light frames found recursively in a folder, grades suspect subs against frames from the same camera, filter, exposure, and night, and can move them aside, restore them, or delete them after confirmation. Kept lights, optional review frames, and the calibration frames found alongside can be sent to WeightedBatchPreprocessing.

## Building an update package

Run:

```bash
python tools/build-release.py 0.2.0
```

This generates the ZIP package and `updates.xri` under `updates/`. The build tool does not publish the files; GitHub Actions deploys the committed contents of `updates/` to GitHub Pages.
