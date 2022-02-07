# svelte-barcode

A light-weight and high-performance component to generate barcode for Svelte.

[![NPM](https://img.shields.io/npm/v/svelte-barcode.svg)](https://www.npmjs.com/package/svelte-barcode) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## 🔧 Install

svelte-barcode is available on npm. It can be installed with the following command:

```
npm install svelte-barcode --save
```

svelte-barcode is available on yarn as well. It can be installed with the following command:

```
yarn add svelte-barcode --save
```

**Note:** Install as a dev dependency ( `npm install svelte-barcode -D` ) ( `yarn add svelte-barcode --dev` ) if using [Sapper](https://sapper.svelte.dev) to avoid a SSR error.

## 💡 Usage

```js
<script>
  import Barcode from 'svelte-barcode';
</script>

<Barcode
  value={'svelte-barcode'}
  elementTag={'canvas'}
  options={{
    format: 'CODE128',
    width: 2,
    height: 100,
    text: '',
    textAlign: 'center',
    textPosition: 'bottom',
    textMargin: 2,
    fontSize: 20,
    background: '#ffffff',
    lineColor: '#000000',
  }}
/>
```

## props

<table>
  <thead>
    <tr>
      <th>Props</th>
      <th>Type</th>
      <th>Default</th>
      <th>Require</th>
      <th>Description</th>
    </tr>
  <thead>
  <tbody>
    <tr>
      <td>value</td>
      <td>string</td>
      <td></td>
      <td>✔️</td>
      <td>Text to generate.</td>
    </tr>
    <tr>
      <td>elementTag</td>
      <td>'img' | 'canvas' | 'svg'</td>
      <td>'img'</td>
      <td>❌</td>
      <td></td>
    </tr>
    <tr>
      <td>options</td>
      <td>any</td>
      <td></td>
      <td>❌</td>
      <td>Options to generate.</td>
    </tr>
  </tbody>
</table>

## options

<table>
  <thead>
    <tr>
      <th>Options</th>
      <th>Type</th>
      <th>Default</th>
      <th>Require</th>
      <th>Description</th>
    </tr>
  <thead>
  <tbody>
    <tr>
      <td>format</td>
      <td>string?</td>
      <td><code>auto</code></td>
      <td>❌</td>
      <td>Select which barcode type to use. Please check the <a href="https://github.com/Bunlong/react-barcodes/wiki">wikipage</a> of the different barcode types for more information.</td>
    </tr>
    <tr>
      <td>width</td>
      <td>number?</td>
      <td><code>2</code></td>
      <td>❌</td>
      <td>The width option is the width of a single bar.</td>
    </tr>
    <tr>
      <td>height</td>
      <td>number?</td>
      <td><code>100</code></td>
      <td>❌</td>
      <td>The height of the barcode.</td>
    </tr>
    <tr>
      <td>displayValue</td>
      <td>boolean?</td>
      <td><code>true</code></td>
      <td>❌</td>
      <td></td>
    </tr>
    <tr>
      <td>text</td>
      <td>string?</td>
      <td><code>undefined</code></td>
      <td>❌</td>
      <td>Overide the text that is diplayed</td>
    </tr>
    <tr>
      <td>fontOptions</td>
      <td>string?</td>
      <td><code>''</code></td>
      <td>❌</td>
      <td>With fontOptions you can add bold or italic text to the barcode.</td>
    </tr>
    <tr>
      <td>font</td>
      <td>string?</td>
      <td><code>'monospace'</code></td>
      <td>❌</td>
      <td>Define the font used for the text in the generated barcode. This can be any default font or a font defined by a @font-face rule.</td>
    </tr>
    <tr>
      <td>textAlign</td>
      <td>string?</td>
      <td><code>'center'</code></td>
      <td>❌</td>
      <td>Set the horizontal alignment of the text. Can be <code>left</code> / <code>center</code> / <code>right</code>.</td>
    </tr>
    <tr>
      <td>textPosition</td>
      <td>string?</td>
      <td><code>'bottom'</code></td>
      <td>❌</td>
      <td>Set the vertical position of the text. Can be <code>bottom</code> / <code>top</code>.</td>
    </tr>
    <tr>
      <td>textMargin</td>
      <td>number?</td>
      <td><code>2</code></td>
      <td>❌</td>
      <td>Set the vertical position of the text. Can be <code>bottom</code> / <code>top</code>.</td>
    </tr>
    <tr>
      <td>fontSize</td>
      <td>number?</td>
      <td><code>20</code></td>
      <td>❌</td>
      <td>Set the size of the text.</td>
    </tr>
    <tr>
      <td>background</td>
      <td>string?</td>
      <td><code>'#ffffff'</code></td>
      <td>❌</td>
      <td>Set the background of the barcode.</td>
    </tr>
    <tr>
      <td>lineColor</td>
      <td>string?</td>
      <td><code>'#000000'</code></td>
      <td>❌</td>
      <td>Set the color of the bars and the text.</td>
    </tr>
    <tr>
      <td>margin</td>
      <td>number?</td>
      <td><code>10</code></td>
      <td>❌</td>
      <td>Set the space margin around the barcode. If nothing else is set, all side will inherit the margins property but can be replaced if you want to set them separably.</td>
    </tr>
    <tr>
      <td>marginTop</td>
      <td>number?</td>
      <td><code>undefined</code></td>
      <td>❌</td>
      <td></td>
    </tr>
    <tr>
      <td>marginBottom</td>
      <td>number?</td>
      <td><code>undefined</code></td>
      <td>❌</td>
      <td></td>
    </tr>
    <tr>
      <td>marginLeft</td>
      <td>number?</td>
      <td><code>undefined</code></td>
      <td>❌</td>
      <td></td>
    </tr>
    <tr>
      <td>marginRight</td>
      <td>number?</td>
      <td><code>undefined</code></td>
      <td>❌</td>
      <td></td>
    </tr>
    <tr>
      <td>flat</td>
      <td>boolean?</td>
      <td><code>false</code></td>
      <td>❌</td>
      <td>Only for <code>EAN8</code> / <code>EAN13</code></td>
    </tr>
  </tbody>
</table>

## ❗ Issues

If you think any of the `svelte-barcode` can be improved, please do open a PR with any updates and submit any issues. Also, I will continue to improve this, so you might want to watch/star this repository to revisit.

## 🌟 Contribution

We'd love to have your helping hand on contributions to `svelte-barcode` by forking and sending a pull request!

Your contributions are heartily ♡ welcome, recognized and appreciated. (✿◠‿◠)

How to contribute:

- Open pull request with improvements
- Discuss ideas in issues
- Spread the word
- Reach out with any feedback

## ⚖️ License

The MIT License [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
