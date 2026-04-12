<script lang="ts">
  import { LANGUAGES, langOption } from "../lib/languages";

  interface Props {
    value?: string;
    name?: string;
  }

  let { value = $bindable("fr"), name = "language" }: Props = $props();

  const codes = Object.keys(LANGUAGES);
</script>

<select {name} bind:value>
  {#each codes as code}
    <option value={code}>{langOption(code)}</option>
  {/each}
</select>
