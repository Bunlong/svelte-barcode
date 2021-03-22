<script>
  import { onMount } from 'svelte';
  import JsBarcode from 'jsbarcode';

  let barcode;
  export let value;
  export let elementTag = 'img';
  export let format = 'CODE128';
  export let width = 2;
  export let height = 100;
  export let displayValue = true;
  export let text = undefined;
  export let fontOptions = '';
  export let font = 'monospace';
  export let textAlign = 'center';
  export let textPosition = 'bottom';
  export let textMargin = 2;
  export let fontSize = 20;
  export let background = '#ffffff';
  export let lineColor = '#000000';
  export let margin = 10;
  export let marginTop = undefined;
  export let marginBottom = undefined;
  export let marginLeft = undefined;
  export let marginRight = undefined;
  export let flat = false;

  const options = {
    format,
    width,
    height,
    displayValue,
    text,
    fontOptions,
    font,
    textAlign,
    textPosition,
    textMargin,
    fontSize,
    background,
    lineColor,
    margin,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    flat,
  };

  onMount(() => {
    JsBarcode(barcode, value, options);
  });
</script>

{#if elementTag === 'img'}
  <img bind:this={barcode} alt="" />
{:else if elementTag === 'canvas'}
  <canvas bind:this={barcode}></canvas>
{:else}
  <svg bind:this={barcode}></svg>
{/if}
