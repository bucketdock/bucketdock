# Changelog

## Unreleased

### Features

- **Object browser**: Type column now shows the real `Content-Type` returned
  by S3 (HEAD per file, batched concurrently) instead of an extension-based
  guess. Falls back to the extension default while the HEAD requests are in
  flight.
- **Copy modal**: Redesigned destination picker. The folder browser is now
  always visible, drives the destination directly, supports breadcrumb
  navigation, and shows the chosen path with a green check. The separate
  prefix text field and "Browse…" toggle are gone.

### Bug Fixes

- **Copy modal**: Fixed broken folder drill-down. Drilling deeper produced a
  doubled prefix (e.g. `photos/photos/2024/`) and an empty listing. Folder
  drill-down now uses the listing's absolute key as the new browse prefix.
  Regression covered by `src/lib/copy-targets.test.ts` and
  `src/components/copy-to-modal.test.tsx`.
- **Window scroll**: Disabled rubber-band scrolling of the entire app shell.
  The window content is now locked (`position: fixed` on body); only the
  designated panes scroll.
- **Titlebar**: Increased the custom title bar height so the macOS traffic
  light buttons sit comfortably and are no longer cramped against the top.
  The "BucketDock" label is centered vertically against them.
- **Object browser table**: Tightened vertical row spacing so file/folder
  rows look denser and more polished.
- **Website**: Mobile responsive overhaul. Fixed the `.shot-card` layout
  that previously misused `grid-template-columns` on a flex container,
  reduced the oversized notice-banner bottom margin on phones, kept the nav
  links visible (with smaller spacing) instead of hiding them, made the
  hero buttons stack full-width, and added a 460px breakpoint for very
  narrow phones.

## [0.1.10](https://github.com/bucketdock/bucketdock/compare/v0.1.9...v0.1.10) (2026-05-06)


### Bug Fixes

* improve folder copying, add tests ([481ba1a](https://github.com/bucketdock/bucketdock/commit/481ba1a302ac1499bb1ec7f503118cf86a72c01c))
* improve pages for mobile ([ff5fe5d](https://github.com/bucketdock/bucketdock/commit/ff5fe5d70cadb02fe1680f0eb770ebfd81036045))
* improve website install page ([6e72d2d](https://github.com/bucketdock/bucketdock/commit/6e72d2d62b0c066cf95f2a7a95eae601c22c140e))
* improve website pages ([1f61ef7](https://github.com/bucketdock/bucketdock/commit/1f61ef74542d1d6cb8c6c25b11b93d7006299b4c))
* improve website pages ([aee2e03](https://github.com/bucketdock/bucketdock/commit/aee2e032ff27ed37777f1fb6c48bda0b7ce44603))
* pages ([e1a4dd0](https://github.com/bucketdock/bucketdock/commit/e1a4dd060dbce55d984b787f7343d5cbb0c0c314))

## [0.1.9](https://github.com/bucketdock/bucketdock/compare/v0.1.8...v0.1.9) (2026-05-03)

### Bug Fixes

- fix refresh file list after folder creation, simplify file coping ([efaaf2c](https://github.com/bucketdock/bucketdock/commit/efaaf2c9f9abc14f8e6bab355f324ff352761ab0))

## [0.1.8](https://github.com/bucketdock/bucketdock/compare/v0.1.7...v0.1.8) (2026-05-03)

### Features

- add select folder when copying, fix window moving, add detailed info on connection error ([e4848f1](https://github.com/bucketdock/bucketdock/commit/e4848f12819145be6357147b03f9d85130050af1))
- added inline filter, preview, copy files/folder between buckets ([3c6536d](https://github.com/bucketdock/bucketdock/commit/3c6536d0e8b34b3df96eacdb71ec1bdfdbf7cf69))

### Bug Fixes

- README.md updates ([e1f1533](https://github.com/bucketdock/bucketdock/commit/e1f15333abbc8bc95b4f7b29c2c2776ae0ac07df))

## [0.1.7](https://github.com/bucketdock/bucketdock/compare/v0.1.6...v0.1.7) (2026-05-03)

### Bug Fixes

- github workflow ([8789135](https://github.com/bucketdock/bucketdock/commit/8789135fd299ac08fc83cf4f7b3a7c541dbe1bc8))

## [0.1.6](https://github.com/bucketdock/bucketdock/compare/v0.1.5...v0.1.6) (2026-05-02)

### Bug Fixes

- fix github workflow ([e63113a](https://github.com/bucketdock/bucketdock/commit/e63113ae3ddf4b15c614d33402d1b5650df7579b))

## [0.1.5](https://github.com/bucketdock/bucketdock/compare/v0.1.4...v0.1.5) (2026-05-02)

### Bug Fixes

- fix links in README.md ([37f4b82](https://github.com/bucketdock/bucketdock/commit/37f4b826b51778e2f788289124b92d9628c6c3d6))
- fix website links ([9297bc5](https://github.com/bucketdock/bucketdock/commit/9297bc5ec7397708eb9e9a30735ea3367b034e2a))

## [0.1.4](https://github.com/bucketdock/bucketdock/compare/v0.1.3...v0.1.4) (2026-05-02)

### Bug Fixes

- iniate relese creation ([3802ab0](https://github.com/bucketdock/bucketdock/commit/3802ab0f29b9c86c35c6fd7deda7ac359a0e8492))

## [0.1.3](https://github.com/bucketdock/bucketdock/compare/v0.1.2...v0.1.3) (2026-05-02)

### Features

- improve installation instructions ([66a7a4f](https://github.com/bucketdock/bucketdock/commit/66a7a4f9dbb263288d013baa191f8bbfd96ce62e))

## [0.1.2](https://github.com/bucketdock/bucketdock/compare/v0.1.1...v0.1.2) (2026-05-01)

### Bug Fixes

- package versions ([34177a6](https://github.com/bucketdock/bucketdock/commit/34177a6fa01df0816da29cf0d766340517d4b00c))

## [0.1.1](https://github.com/bucketdock/bucketdock/compare/v0.1.0...v0.1.1) (2026-05-01)

### Features

- add basic coping from bucket to bucket, basic progress ([4cc0a89](https://github.com/bucketdock/bucketdock/commit/4cc0a892ab5e91c0b66bc8e6b89f6b437a15e554))
- add basic website ([8dfa608](https://github.com/bucketdock/bucketdock/commit/8dfa60869a74c2f903e50d17f369084145197e29))
- add github workflows ([70b00a3](https://github.com/bucketdock/bucketdock/commit/70b00a345a6c94fb555a5b7354e5d01a19292c7a))
- basic README.md ([ef07acb](https://github.com/bucketdock/bucketdock/commit/ef07acbaa22a0c60ddffd22d7b074c2dd47d023d))
- fix determining keys, improve readme ([a58c5ae](https://github.com/bucketdock/bucketdock/commit/a58c5ae2569cb7c0d0ad71de67e0c47d8056c232))
- improve README.md ([7361da3](https://github.com/bucketdock/bucketdock/commit/7361da3160c43bf1e9ecaab7b65124b8089b882e))
- use tauri, add basic functionality ([a99e203](https://github.com/bucketdock/bucketdock/commit/a99e203bb65b063cbd63026b3b62c2ae33b3d4d8))
