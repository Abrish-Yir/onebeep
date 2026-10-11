# Onebeep

**Contactless vitals from a webcam.** Onebeep measures heart rate (and estimate
respiration rate and SpO₂) from subtle, pulse-driven colour changes in the skin
of your face — no contact, no wearable. Everything is computed on the device;
no video, landmarks, or readings ever leave the browser.

## How it works

Remote photoplethysmography (rPPG). Every heartbeat pushes a bolus of blood
through the capillaries, which slightly changes how much light the skin absorbs.
Averaging the skin's RGB over the cheeks and forehead across frames produces a
tiny periodic signal at the pulse frequency. The pulse is recovered with the
**POS** (plane-orthogonal-to-skin) algorithm, band-pass filtered, and the
dominant spectral peak (FFT) is taken as the heart rate.

## Stack

- React + TypeScript + Vite
- MediaPipe Face Landmarker (478-point face mesh, runs in-browser / on GPU)
- Hand-rolled DSP + canvas plots — no server, no analytics

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # outputs static site to dist/
npm run preview
```

## Deploy (EthioDeploy)

Push this repository to GitHub, then connect it in EthioDeploy. It auto-detects
the Vite build and publishes to `https://<slug>.ethiodeploy.com/`.

## Disclaimer

Not a medical device. Onebeep is a research and educational demo — do not use
its readings for diagnosis or treatment decisions.
