<script lang="ts">
  import { LANGUAGES } from "../lib/languages";

  interface Props {
    value?: string;
    name?: string;
  }

  let { value = $bindable("fr"), name = "language" }: Props = $props();

  const entries = Object.entries(LANGUAGES);
</script>

<select {name} bind:value>
  {#each entries as [code, label]}
    <option value={code}>{label}</option>
  {/each}
</select>
