# OBS IRL Scene Switcher

This is a web page that will monitor an srt stream from [srt-live-server](https://github.com/b3ck/sls-b3ck-edit) and auto switch scenes in OBS if the bitrate drops or the connection goes down. Requires OBS version 28+ with the websockets server enabled.

View the hosted version here: https://obs-irl-scene-switcher.surge.sh/

You will need to leave this webpage running in a web browser OR add this webpage as a "Dock" in OBS (Docks -> Custom Browser Docks).

This page uses the `/stats` endpoint of [srt-live-server](https://github.com/b3ck/sls-b3ck-edit) to determine the bitrate and if a stream is up / down.

# Local Development /  Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```
