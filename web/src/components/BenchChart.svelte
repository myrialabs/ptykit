<script lang="ts">
	interface Bar {
		label: string;
		value: number;
		display: string;
		highlight?: boolean;
	}
	interface Props {
		bars: Bar[];
		unit: string;
	}
	let { bars, unit }: Props = $props();

	const max = $derived(Math.max(...bars.map((b) => b.value)));
</script>

<div class="chart">
	{#each bars as bar (bar.label)}
		<div class="row">
			<div class="row-label">{bar.label}</div>
			<div class="row-track">
				<div class="row-fill" class:highlight={bar.highlight} style="width: {Math.max(3, (bar.value / max) * 100)}%"></div>
			</div>
			<div class="row-value">{bar.display} <span class="unit">{unit}</span></div>
		</div>
	{/each}
</div>

<style>
	.chart { display: flex; flex-direction: column; gap: 14px; }
	.row { display: grid; grid-template-columns: 150px minmax(0, 1fr) 110px; align-items: center; gap: 16px; }
	.row-label { font-size: 14px; font-weight: 600; color: var(--text-1); font-family: 'JetBrains Mono', monospace; }
	.row-track { background: var(--bg-1); border-radius: 8px; height: 34px; overflow: hidden; border: 1px solid var(--border); }
	.row-fill {
		height: 100%; border-radius: 7px;
		background: linear-gradient(90deg, var(--accent-dark), var(--bg-4));
		transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.row-fill.highlight { background: linear-gradient(90deg, var(--accent-1), var(--accent-2)); }
	.row-value { font-size: 14px; font-weight: 700; color: var(--text-0); font-family: 'JetBrains Mono', monospace; text-align: right; }
	.row-value .unit { font-size: 11px; font-weight: 500; color: var(--text-2); }

	@media (max-width: 640px) {
		.row { grid-template-columns: minmax(0, 1fr); gap: 6px; }
		.row-value { text-align: left; }
	}
</style>
