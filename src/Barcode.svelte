<script>
  import { onMount, tick, afterUpdate } from 'svelte';
  import JsBarcode from 'jsbarcode';

  let barcode;
  export let value;
  export let elementTag = 'img';
  export let options;
  const defaultOptions = {
    format: 'CODE128',
    width: 2,
    height: 100,
    displayValue: true,
    text: undefined,
    fontOptions: '',
    font: 'monospace',
    textAlign: 'center',
    textPosition: 'bottom',
    textMargin: 2,
    fontSize: 20,
    background: '#ffffff',
    lineColor: '#000000',
    margin: 10,
    marginTop: undefined,
    marginBottom: undefined,
    marginLeft: undefined,
    marginRight: undefined,
    flat: true,
  };

  onMount(async () => {
    await tick();
    JsBarcode(barcode, value, optionsOA);
  });

  afterUpdate(async () => {
    await tick();
	  JsBarcode(barcode, value, Object.assign(defaultOptions, options));
  });
</script>

{#if elementTag === 'img'}
  <img bind:this={barcode} alt="" />
{:else if elementTag === 'canvas'}
  <canvas bind:this={barcode}></canvas>
{:else}
  <svg bind:this={barcode}></svg>
{/if}
