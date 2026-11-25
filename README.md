# little city

a little hand-drawn city builder. you place a few blocks, they turn into a town, and then people move in and start living there.

it's free, runs in your browser, works on your phone too.

**[play it → littlecity.io](https://littlecity.io/?utm_source=github)**

[![a hand-drawn island town with a castle, a harbour and a lighthouse](docs/readme/welcome.jpg)](https://littlecity.io/?utm_source=github)

you can fly down into it and just look around. yes, you can nuke it, they'll build it back. or hit "grow a town" and it builds a whole one for you.

| ![flying through a wedding on the square](docs/readme/fly.jpg) | ![a mushroom cloud over the town](docs/readme/nuke.jpg) | ![a whole new town, grown by itself](docs/readme/grow.jpg) |
| --- | --- | --- |

there are over 80 special buildings and events to find: [the guide](https://littlecity.io/guide/) has them all. no art files for the town, every line is drawn in code.

## run it

needs node 22.12 or newer.

```sh
npm install
npm run dev
```

`npm run check` runs the types, the lint and the tests. it's typescript and [three.js](https://threejs.org).

production builds send analytics to the key in `.env.production`. hosting your own copy? empty it or put in yours.

## license

[MIT](LICENSE). made by [Derek Yao](https://github.com/yaoderek), with [Nano-AI](https://github.com/Nano-AI).
