import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const CHANNELS = ["Meta", "Google Search", "LinkedIn"] as const;

type Channel = (typeof CHANNELS)[number];

type AttributionModel = "last_click" | "position_based" | "time_decay" | "bayesian_mmm";

type SaturationLevel = "low" | "medium" | "high";

type NoiseLevel = "low" | "medium" | "high";

type ConversionWindow = 7 | 14 | 30;

interface SimulationInput {
  spend: Record<Channel, number>;
  model: AttributionModel;
  window: ConversionWindow;
  saturation: SaturationLevel;
  noise: NoiseLevel;
}

interface ChannelOutput {
  channel: Channel;
  roas: number;
  cac: number;
  attributedConversions: number;
  incrementalConversions: number;
  certainty: "Low" | "Medium" | "High";
}

interface BudgetPlanRow {
  channel: Channel;
  before: number;
  after: number;
}

function simulateAttribution(input: SimulationInput): ChannelOutput[] {
  const baseEfficiency: Record<Channel, number> = {
    Meta: 3.2,
    "Google Search": 4.0,
    LinkedIn: 2.4,
  };

  const prospectingWeight: Record<Channel, number> = {
    Meta: 0.45,
    "Google Search": 0.2,
    LinkedIn: 0.7,
  };

  const retargetingBias: Record<Channel, number> = {
    Meta: 0.2,
    "Google Search": 0.35,
    LinkedIn: 0.1,
  };

  const windowMultiplier: Record<ConversionWindow, number> = {
    7: 0.8,
    14: 0.95,
    30: 1.1,
  };

  const saturationPenalty = (level: SaturationLevel, spend: number): number => {
    const normalizedSpend = spend / 100000;
    const base = level === "low" ? 0.1 : level === "medium" ? 0.25 : 0.45;
    return 1 - Math.min(base * normalizedSpend, base + 0.15);
  };

  const noiseFactor = (level: NoiseLevel): number => {
    if (level === "low") return 0.05;
    if (level === "medium") return 0.12;
    return 0.22;
  };

  const modelWeights = (model: AttributionModel): Record<Channel, number> => {
    switch (model) {
      case "last_click":
        return { Meta: 0.3, "Google Search": 0.55, LinkedIn: 0.15 };
      case "position_based":
        return { Meta: 0.4, "Google Search": 0.4, LinkedIn: 0.2 };
      case "time_decay":
        return { Meta: 0.35, "Google Search": 0.45, LinkedIn: 0.2 };
      case "bayesian_mmm":
        return { Meta: 0.38, "Google Search": 0.32, LinkedIn: 0.3 };
    }
  };

  const weights = modelWeights(input.model);
  const noise = noiseFactor(input.noise);

  const totalSpend = CHANNELS.reduce((sum, ch) => sum + input.spend[ch], 0) || 1;

  return CHANNELS.map((channel) => {
    const spend = input.spend[channel];

    const effectiveROAS =
      baseEfficiency[channel] *
      windowMultiplier[input.window] *
      saturationPenalty(input.saturation, spend) *
      (1 + (prospectingWeight[channel] - retargetingBias[channel]) * 0.2);

    const attributedShare = weights[channel];
    const noisyShare =
      attributedShare +
      (retargetingBias[channel] - prospectingWeight[channel]) * noise * (input.model === "last_click" ? 1.2 : 0.8);

    const boundedShare = Math.max(0.05, Math.min(0.7, noisyShare));

    const modeledRevenue = spend * effectiveROAS;
    const blendedROAS = modeledRevenue / Math.max(spend, 1);
    const conversions = modeledRevenue / 500;

    const incrementalShare =
      prospectingWeight[channel] * 0.6 +
      (1 - retargetingBias[channel]) * 0.2 +
      (input.model === "bayesian_mmm" ? 0.2 : 0.1);

    const incrementalRevenue = modeledRevenue * incrementalShare * (1 - noise * 0.4);
    const incrementalConversions = incrementalRevenue / 500;

    const cac = spend / Math.max(conversions, 1);

    let certainty: "Low" | "Medium" | "High" = "Medium";
    if (input.model === "bayesian_mmm" && input.window === 30 && input.noise === "low") {
      certainty = "High";
    } else if (input.noise === "high" || input.window === 7) {
      certainty = "Low";
    }

    return {
      channel,
      roas: blendedROAS * boundedShare,
      cac,
      attributedConversions: conversions * boundedShare,
      incrementalConversions,
      certainty,
    };
  });
}

function deriveBudgetPlan(spend: Record<Channel, number>, model: AttributionModel): BudgetPlanRow[] {
  const total = CHANNELS.reduce((sum, ch) => sum + spend[ch], 0) || 1;

  const overCreditedBase: Record<Channel, number> = {
    Meta: model === "last_click" ? 0.4 : 0.3,
    "Google Search": model === "last_click" ? 0.55 : 0.45,
    LinkedIn: 0.15,
  };

  const underCreditedBase: Record<Channel, number> = {
    Meta: 0.35,
    "Google Search": 0.2,
    LinkedIn: 0.45,
  };

  const reallocationIntensity = model === "bayesian_mmm" ? 0.35 : 0.28;

  const beforeShares = CHANNELS.reduce<Record<Channel, number>>((acc, ch) => {
    acc[ch] = spend[ch] / total;
    return acc;
  }, {} as Record<Channel, number>);

  let pool = 0;
  const afterShares: Record<Channel, number> = { ...beforeShares };

  CHANNELS.forEach((ch) => {
    const over = overCreditedBase[ch];
    const giveBack = Math.max(0, beforeShares[ch] - over) * reallocationIntensity;
    afterShares[ch] = Math.max(0.08, beforeShares[ch] - giveBack);
    pool += giveBack;
  });

  const totalUnderWeight = CHANNELS.reduce((sum, ch) => sum + underCreditedBase[ch], 0);

  CHANNELS.forEach((ch) => {
    const allocation = (underCreditedBase[ch] / totalUnderWeight) * pool;
    afterShares[ch] += allocation;
  });

  const normalize = CHANNELS.reduce((sum, ch) => sum + afterShares[ch], 0) || 1;

  return CHANNELS.map((channel) => ({
    channel,
    before: (beforeShares[channel] / normalize) * total,
    after: (afterShares[channel] / normalize) * total,
  }));
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const Index = () => {
  const [spendMeta, setSpendMeta] = useState(120000);
  const [spendGoogle, setSpendGoogle] = useState(90000);
  const [spendLinkedIn, setSpendLinkedIn] = useState(60000);
  const [model, setModel] = useState<AttributionModel>("bayesian_mmm");
  const [window, setWindow] = useState<ConversionWindow>(30);
  const [saturation, setSaturation] = useState<SaturationLevel>("medium");
  const [noise, setNoise] = useState<NoiseLevel>("medium");

  const spend: Record<Channel, number> = {
    Meta: spendMeta,
    "Google Search": spendGoogle,
    LinkedIn: spendLinkedIn,
  };

  const outputs = useMemo(
    () =>
      simulateAttribution({
        spend,
        model,
        window,
        saturation,
        noise,
      }),
    [spendMeta, spendGoogle, spendLinkedIn, model, window, saturation, noise],
  );

  const budgetPlan = useMemo(() => deriveBudgetPlan(spend, model), [spendMeta, spendGoogle, spendLinkedIn, model]);

  const totalSpend = spendMeta + spendGoogle + spendLinkedIn;
  const totalRevenue = outputs.reduce((sum, o) => sum + o.roas * spend[o.channel], 0);
  const totalConversions = outputs.reduce((sum, o) => sum + o.attributedConversions, 0);
  const blendedROAS = totalRevenue / Math.max(totalSpend, 1);
  const blendedCAC = totalSpend / Math.max(totalConversions, 1);

  const afterSpendTotal = budgetPlan.reduce((sum, row) => sum + row.after, 0) || 1;
  const simulatedEfficiencyGain = model === "bayesian_mmm" ? 0.18 : model === "time_decay" ? 0.14 : 0.11;

  const roasChartData = outputs.map((o) => ({
    channel: o.channel,
    ROAS: Number(o.roas.toFixed(2)),
    CAC: Number(o.cac.toFixed(0)),
  }));

  const incrementalChartData = outputs.map((o) => ({
    channel: o.channel,
    Incremental: Number(o.incrementalConversions.toFixed(1)),
    Attributed: Number(o.attributedConversions.toFixed(1)),
  }));

  const weeklySeries = useMemo(
    () => {
      const weeks = 12;
      const baseRoas = blendedROAS || 1;
      const baseCac = blendedCAC || 1;

      const lagFactor = window === 7 ? 0.6 : window === 14 ? 0.8 : 1;
      const saturationFactor = saturation === "low" ? 1.05 : saturation === "medium" ? 1 : 0.9;
      const noiseAmplitude = noise === "low" ? 0.04 : noise === "medium" ? 0.08 : 0.14;
      const trendDrift = model === "bayesian_mmm" ? 0.015 : model === "time_decay" ? 0.01 : 0.005;

      let seed = Math.floor(
        totalSpend / 1000 + (model === "bayesian_mmm" ? 17 : model === "time_decay" ? 11 : 5) + window,
      );
      const rand = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const startingRoas = baseRoas * lagFactor * saturationFactor;
      const startingCac = baseCac / (lagFactor * saturationFactor || 1);

      return Array.from({ length: weeks }, (_, idx) => {
        const weekIndex = idx + 1;
        const centeredIndex = weekIndex - (weeks / 2 + 0.5);
        const structuralTrend = 1 + trendDrift * centeredIndex;
        const shock = 1 + (rand() - 0.5) * 2 * noiseAmplitude;
        const mmmNoise = 1 + (rand() - 0.5) * noiseAmplitude * 1.5;

        const roas = startingRoas * structuralTrend * shock * mmmNoise;
        const cac = startingCac * (2 - structuralTrend) * (1 + (rand() - 0.5) * noiseAmplitude);

        return {
          week: `W${weekIndex}`,
          ROAS: Number(roas.toFixed(2)),
          CAC: Number(Math.max(cac, 1).toFixed(0)),
        };
      });
    },
    [blendedROAS, blendedCAC, window, saturation, noise, model, totalSpend],
  );

  const weeklySeriesOptimized = useMemo(
    () => {
      const uplift = 1 + simulatedEfficiencyGain * 0.65;
      const weeks = weeklySeries.length || 0;

      return weeklySeries.map((point, idx) => {
        const midPoint = weeks / 2 + 0.5;
        const ramp = 0.9 + (idx + 1 - midPoint) * 0.01;
        const boundedRamp = Math.max(0.8, Math.min(1.1, ramp));

        return {
          week: point.week,
          ROAS: Number((point.ROAS * uplift * boundedRamp).toFixed(2)),
          CAC: Number((point.CAC / (uplift * boundedRamp || 1)).toFixed(0)),
        };
      });
    },
    [weeklySeries, simulatedEfficiencyGain],
  );

  const perChannelWeeklySeries = useMemo(
    () => {
      const weeks = weeklySeries.length || 0;
      if (!weeks) return [] as Array<{ week: string } & Record<Channel, number>>;

      const baseRoasByChannel: Record<Channel, number> = CHANNELS.reduce((acc, ch) => {
        const found = outputs.find((o) => o.channel === ch);
        acc[ch] = found ? found.roas || 1 : 1;
        return acc;
      }, {} as Record<Channel, number>);

      return Array.from({ length: weeks }, (_, idx) => {
        const weekIndex = idx + 1;
        const variance = 1 + (idx - weeks / 2) * 0.01;

        const row: { week: string } & Record<Channel, number> = {
          week: `W${weekIndex}`,
          Meta: 0,
          "Google Search": 0,
          LinkedIn: 0,
        } as { week: string } & Record<Channel, number>;

        CHANNELS.forEach((ch, channelIdx) => {
          const channelDrift = 1 + (channelIdx - 1) * 0.03;
          const roas = baseRoasByChannel[ch] * variance * channelDrift;
          row[ch] = Number(roas.toFixed(2));
        });

        return row;
      });
    },
    [weeklySeries, outputs],
  );

  type CohortRow = {
    bucket: string;
    cumulative: number;
    incremental: number;
    note: string;
  };

  const cohortTable: CohortRow[] = useMemo(() => {
    const baseCurve = window === 7 ? [0.55, 0.8, 0.95, 1] : window === 14 ? [0.35, 0.6, 0.8, 0.92, 0.98, 1] : [
      0.18,
      0.35,
      0.55,
      0.72,
      0.85,
      0.93,
      0.97,
      1,
    ];

    const noiseAdjust = noise === "low" ? 0.01 : noise === "medium" ? 0.03 : 0.06;

    const rows: CohortRow[] = [];
    let prev = 0;

    baseCurve.forEach((cum, idx) => {
      const adjustedCum = Math.max(0, Math.min(1, cum + (idx - baseCurve.length / 2) * noiseAdjust * 0.1));
      const incremental = Math.max(0, adjustedCum - prev);
      prev = adjustedCum;

      rows.push({
        bucket: idx === 0 ? "Week 0–1" : `Week ${idx}–${idx + 1}`,
        cumulative: adjustedCum,
        incremental,
        note:
          idx === 0
            ? "Short-lag, lower-funnel dominated conversions."
            : idx < 3
              ? "Mix of retargeting and some prospecting-driven conversions."
              : "Longer-lag, prospecting-heavy cohorts with higher modeled incremental lift.",
      });
    });

    return rows;
  }, [window, noise]);

  return (
    <div className="min-h-screen bg-[hsl(var(--surface-subtle))]">
      <header className="border-b bg-background/90 backdrop-blur-sm">
        <div className="container mx-auto flex flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Interactive case study · B2B SaaS attribution
            </p>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              End-to-End Marketing Attribution System
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Unified data pipeline ingesting API data into BigQuery for cross-channel comparison, incrementality
              measurement, and budget optimization.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <Badge
              variant="outline"
              className="border-primary/40 bg-primary/5 px-3 py-1 text-[11px] font-medium text-primary-foreground shadow-sm"
            >
              → Shifted ~30% budget to high-performing channels
            </Badge>
            <p className="max-w-xs text-[11px] text-muted-foreground text-right">
              Built as a production-grade reference for executive stakeholders assessing decision-grade attribution and
              MMM.
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-10">
        {/* Problem context */}
        <section
          aria-labelledby="problem-context"
          className="grid gap-6 rounded-xl bg-card p-6 shadow-sm md:grid-cols-12"
        >
          <div className="md:col-span-5 space-y-3">
            <h2 id="problem-context">Why platform-reported ROAS fails</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              Executive teams are often making multi-million dollar allocation decisions on top of siloed,
              last-click-biased reporting surfaces that systematically over-credit lower-funnel spend.
            </p>
          </div>
          <div className="md:col-span-7 grid gap-4 md:grid-cols-2 text-sm text-muted-foreground">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground/80">
                Where the numbers break
              </p>
              <div className="rounded-lg bg-muted/60 p-3">
                • Platform silos: each network claims 100% credit for the same conversion.
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                • Last-click bias over-credits branded search, retargeting, and bottom-funnel campaigns.
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                • Little to no visibility into incrementality or marginal ROI by channel.
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                • No reliable answer to “where should the next $10K go?” across channels.
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground/80">
                What decision-makers need instead
              </p>
              <div className="rounded-lg bg-secondary/70 p-3">
                • Unified, de-duplicated view of revenue and conversions across all paid and organic touches.
              </div>
              <div className="rounded-lg bg-secondary/70 p-3">
                • Side-by-side comparison of platform-reported vs. modeled performance.
              </div>
              <div className="rounded-lg bg-secondary/70 p-3">
                • Incrementality-aware ROAS, CAC, and iROAS by channel, region, and audience.
              </div>
              <div className="rounded-lg bg-secondary/70 p-3">
                • Clear budget recommendations with quantified upside and confidence bands.
              </div>
            </div>
          </div>
        </section>

        {/* Simulator + outputs */}
        <section aria-labelledby="simulator" className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="simulator">Attribution simulator</h2>
            <p className="text-xs text-muted-foreground max-w-md text-right">
              This simulator uses synthetic but realistic channel curves, lag structures, and attribution weights to
              illustrate how different models can reshape budget decisions.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)]">
            {/* Inputs */}
            <Card className="self-start border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Input assumptions</CardTitle>
                <CardDescription className="text-xs">
                  Adjust monthly spend, attribution logic, conversion windows, and structural noise.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 text-sm">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Monthly spend by channel</p>
                    <span className="text-xs text-muted-foreground">
                      Total: {currencyFormatter.format(totalSpend)} / month
                    </span>
                  </div>

                  <InputSlider
                    label="Meta Ads"
                    value={spendMeta}
                    min={20000}
                    max={250000}
                    step={5000}
                    onChange={setSpendMeta}
                  />

                  <InputSlider
                    label="Google Search"
                    value={spendGoogle}
                    min={20000}
                    max={250000}
                    step={5000}
                    onChange={setSpendGoogle}
                  />

                  <InputSlider
                    label="LinkedIn Ads"
                    value={spendLinkedIn}
                    min={15000}
                    max={200000}
                    step={5000}
                    onChange={setSpendLinkedIn}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Attribution model</p>
                    <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent className="text-xs max-h-72">
                        <SelectItem value="last_click">Last click (rule-based)</SelectItem>
                        <SelectItem value="position_based">Position-based / U-shaped (40-20-40)</SelectItem>
                        <SelectItem value="time_decay">Time-decay (recency weighted)</SelectItem>
                        <SelectItem value="bayesian_mmm">Bayesian MMM (simplified)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Below, you&apos;ll see a gallery of additional models (Shapley, Markov, MMM, geo-lift) and when they
                      are appropriate. The selector here drives the synthetic numbers in this case study.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Conversion window</p>
                    <Select value={String(window)} onValueChange={(v) => setWindow(Number(v) as ConversionWindow)}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Select window" />
                      </SelectTrigger>
                      <SelectContent className="text-xs">
                        <SelectItem value="7">7 days</SelectItem>
                        <SelectItem value="14">14 days</SelectItem>
                        <SelectItem value="30">30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <OptionTabs
                    label="Saturation & diminishing returns"
                    value={saturation}
                    onChange={(value) => setSaturation(value as SaturationLevel)}
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                    ]}
                  />

                  <OptionTabs
                    label="Noise / attribution bias level"
                    value={noise}
                    onChange={(value) => setNoise(value as NoiseLevel)}
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                    ]}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Outputs */}
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <SummaryMetric
                  label="Blended ROAS"
                  value={numberFormatter.format(blendedROAS)}
                  helper="Revenue / total spend after model & saturation adjustments."
                />
                <SummaryMetric
                  label="Blended CAC"
                  value={currencyFormatter.format(blendedCAC)}
                  helper="Cost per modeled conversion, cross-channel."
                />
                <SummaryMetric
                  label="Modeled revenue"
                  value={currencyFormatter.format(totalRevenue)}
                  helper="Attribution-adjusted revenue for the selected window."
                />
              </div>

              {/* Channel performance */}
              <Card className="relative overflow-hidden border-border/80 shadow-sm">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-10 rounded-b-[32px] border border-primary/30 bg-gradient-to-b from-primary/5 to-transparent" />
                <CardHeader className="relative z-10 pb-0">
                  <CardTitle className="text-sm">Channel-level performance</CardTitle>
                  <CardDescription className="text-xs">
                    ROAS, CAC, and incremental contribution by channel under the current assumptions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10 pt-4 space-y-4">
                  <Tabs defaultValue="roas" className="space-y-3">
                    <TabsList className="grid w-full grid-cols-3 bg-muted/70">
                      <TabsTrigger value="roas" className="text-xs">
                        ROAS & CAC
                      </TabsTrigger>
                      <TabsTrigger value="incremental" className="text-xs">
                        Incremental vs. attributed
                      </TabsTrigger>
                      <TabsTrigger value="time" className="text-xs">
                        Time-series (weekly)
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="roas" className="space-y-3">
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={roasChartData} barGap={8}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                            <XAxis dataKey="channel" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis
                              yAxisId="left"
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              label={{ value: "ROAS", angle: -90, position: "insideLeft", fontSize: 10 }}
                            />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              label={{ value: "CAC", angle: 90, position: "insideRight", fontSize: 10 }}
                            />
                            <RechartsTooltip
                              contentStyle={{ fontSize: 11 }}
                              formatter={(value: number, name: string) =>
                                name === "ROAS" ? numberFormatter.format(value) : currencyFormatter.format(value)
                              }
                            />
                            <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                            <Bar yAxisId="left" dataKey="ROAS" fill="hsl(var(--primary))" radius={4} />
                            <Bar yAxisId="right" dataKey="CAC" fill="hsl(var(--accent))" radius={4} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </TabsContent>

                    <TabsContent value="incremental" className="space-y-3">
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={incrementalChartData} barGap={10}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                            <XAxis dataKey="channel" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <RechartsTooltip contentStyle={{ fontSize: 11 }} />
                            <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                            <Bar dataKey="Attributed" fill="hsl(var(--muted-foreground))" radius={4} />
                            <Bar dataKey="Incremental" fill="hsl(var(--primary))" radius={4} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </TabsContent>

                    <TabsContent value="time" className="space-y-3">
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={weeklySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                            <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis
                              yAxisId="left"
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              label={{ value: "ROAS", angle: -90, position: "insideLeft", fontSize: 10 }}
                            />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              label={{ value: "CAC", angle: 90, position: "insideRight", fontSize: 10 }}
                            />
                            <RechartsTooltip
                              contentStyle={{ fontSize: 11 }}
                              formatter={(value: number, name: string) =>
                                name === "ROAS" ? numberFormatter.format(value) : currencyFormatter.format(value)
                              }
                            />
                            <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                            <Line
                              yAxisId="left"
                              type="monotone"
                              dataKey="ROAS"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 3 }}
                            />
                            <Line
                              yAxisId="right"
                              type="monotone"
                              dataKey="CAC"
                              stroke="hsl(var(--accent))"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 3 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Weekly trends incorporate cohort-based conversion lags, saturation effects, and MMM-style noise
                        to illustrate how apparent performance can drift over time even when underlying demand is
                        stable.
                      </p>
                    </TabsContent>
                  </Tabs>

                  <div className="mt-2 rounded-lg border border-dashed border-border/70 bg-muted/60 p-3 text-xs text-muted-foreground">
                    <p>
                      Confidence bands are directional. Longer windows and Bayesian MMM assumptions generally increase
                      certainty, while high noise and short windows reduce it.
                    </p>
                    <div className="mt-2 grid gap-1 md:grid-cols-3">
                      {outputs.map((o) => (
                        <div key={o.channel} className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-medium text-foreground">{o.channel}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[11px]">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                o.certainty === "High"
                                  ? "bg-primary"
                                  : o.certainty === "Medium"
                                    ? "bg-accent"
                                    : "bg-destructive"
                              }`}
                            />
                            {o.certainty} certainty
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Time-series & cohorts card */}
              <Card className="border-border/80 bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm">Time-series & cohort dynamics</CardTitle>
                  <CardDescription className="text-xs max-w-2xl">
                    Weekly ROAS, CAC, and conversion lag structure under the current mix versus an optimized
                    reallocation scenario, plus how cohorts realize over time.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Tabs defaultValue="blended" className="space-y-3">
                    <TabsList className="grid w-full grid-cols-3 bg-muted/70">
                      <TabsTrigger value="blended" className="text-xs">
                        Blended weekly trends
                      </TabsTrigger>
                      <TabsTrigger value="per_channel" className="text-xs">
                        Per-channel ROAS
                      </TabsTrigger>
                      <TabsTrigger value="cohorts" className="text-xs">
                        Lagged cohorts
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="blended" className="space-y-4">
                      <div className="h-40 md:h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={weeklySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                            <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              label={{ value: "ROAS", angle: -90, position: "insideLeft", fontSize: 10 }}
                            />
                            <RechartsTooltip
                              contentStyle={{ fontSize: 11 }}
                              formatter={(value: number) => numberFormatter.format(value)}
                            />
                            <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                            <Line
                              type="monotone"
                              dataKey="ROAS"
                              name="Current mix ROAS"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 3 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="ROAS"
                              data={weeklySeriesOptimized}
                              name="Optimized mix ROAS"
                              stroke="hsl(var(--accent))"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 3 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="h-40 md:h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={weeklySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                            <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              label={{ value: "CAC", angle: -90, position: "insideLeft", fontSize: 10 }}
                            />
                            <RechartsTooltip
                              contentStyle={{ fontSize: 11 }}
                              formatter={(value: number) => currencyFormatter.format(value)}
                            />
                            <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                            <Line
                              type="monotone"
                              dataKey="CAC"
                              name="Current mix CAC"
                              stroke="hsl(var(--muted-foreground))"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 3 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="CAC"
                              data={weeklySeriesOptimized}
                              name="Optimized mix CAC"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              strokeDasharray="5 4"
                              dot={false}
                              activeDot={{ r: 3 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Optimized curves apply the modeled efficiency gain while preserving week-to-week volatility,
                        illustrating how MMM-style reallocation affects trend-level ROAS and CAC rather than any
                        single point estimate.
                      </p>
                    </TabsContent>

                    <TabsContent value="per_channel" className="space-y-3">
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={perChannelWeeklySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                            <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              label={{ value: "ROAS by channel", angle: -90, position: "insideLeft", fontSize: 10 }}
                            />
                            <RechartsTooltip
                              contentStyle={{ fontSize: 11 }}
                              formatter={(value: number) => numberFormatter.format(value)}
                            />
                            <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                            <Line
                              type="monotone"
                              dataKey="Meta"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="Google Search"
                              stroke="hsl(var(--accent))"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="LinkedIn"
                              stroke="hsl(var(--muted-foreground))"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Channel curves are scaled off the modeled ROAS for each platform, highlighting how Meta,
                        Google Search, and LinkedIn respond differently to lag, saturation, and volatility.
                      </p>
                    </TabsContent>

                    <TabsContent value="cohorts" className="space-y-3">
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[30%]">Lag bucket</TableHead>
                            <TableHead>Cumulative conversions realized</TableHead>
                            <TableHead>Incremental this week</TableHead>
                            <TableHead className="hidden md:table-cell">Interpretation</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cohortTable.map((row) => (
                            <TableRow key={row.bucket}>
                              <TableCell className="font-medium">{row.bucket}</TableCell>
                              <TableCell>{percentFormatter.format(row.cumulative)}</TableCell>
                              <TableCell>{percentFormatter.format(row.incremental)}</TableCell>
                              <TableCell className="hidden md:table-cell text-[11px] text-muted-foreground">
                                {row.note}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <p className="text-[11px] text-muted-foreground">
                        Cohorts approximate how quickly different windows realize conversions. Short windows overweight
                        lower-funnel activity, while longer windows surface slower, prospecting-driven revenue that
                        MMM-style models tend to attribute more incremental value to.
                      </p>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* Budget reallocation summary */}
              <Card className="border-border/80 bg-gradient-to-r from-primary/5 via-background to-accent/5 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center justify-between gap-3">
                    Decision-grade summary
                    <span className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Model: {model === "bayesian_mmm" ? "Bayesian MMM (simplified)" : model.replace("_", " ")}
                    </span>
                  </CardTitle>
                  <CardDescription className="text-xs max-w-2xl">
                    Based on the current assumptions, the system recommends reallocating budget away from over-credited
                    lower-funnel impressions towards under-credited demand creation to improve blended CAC.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)] items-start">
                  <div className="space-y-2 text-xs">
                    <p>
                      Reallocating approximately <span className="font-semibold">30% of spend</span> from
                      over-credited channels to under-credited channels improves modeled blended CAC by roughly
                      <span className="font-semibold"> {percentFormatter.format(simulatedEfficiencyGain)}</span> while
                      preserving overall volume.
                    </p>
                    <p className="text-muted-foreground">
                      The exact mix will depend on your vertical, payback targets, and appetite for short-term
                      volatility, but the directional signal is robust across most noise scenarios.
                    </p>
                  </div>

                  <div className="rounded-lg border bg-background/70 p-3">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Budget reallocation (directional)
                    </p>
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[40%]">Channel</TableHead>
                          <TableHead>Before</TableHead>
                          <TableHead>After</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {budgetPlan.map((row) => (
                          <TableRow key={row.channel}>
                            <TableCell className="font-medium">{row.channel}</TableCell>
                            <TableCell>{currencyFormatter.format(row.before)}</TableCell>
                            <TableCell>{currencyFormatter.format(row.after)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Totals are normalized to maintain a monthly budget of {currencyFormatter.format(afterSpendTotal)}.
                      Figures are indicative, not prescriptive.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Architecture overview */}
        <section
          aria-labelledby="architecture-overview"
          className="grid gap-6 rounded-xl bg-card p-6 shadow-sm md:grid-cols-12"
        >
          <div className="md:col-span-4 space-y-3">
            <h2 id="architecture-overview">Architecture overview</h2>
            <p className="text-sm text-muted-foreground">
              Conceptual end-to-end architecture for turning fragmented ad platform exports into normalized,
              decision-grade attribution and MMM outputs.
            </p>
          </div>
          <div className="md:col-span-8 space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-5 items-stretch">
              <ArchitecturePill title="Ad platform APIs" subtitle="Meta / Google / LinkedIn" />
              <ArchitectureArrow />
              <ArchitecturePill title="Raw ingestion" subtitle="Batch & streaming loads" />
              <ArchitectureArrow />
              <ArchitecturePill title="Normalized warehouse" subtitle="Unified schemas & currencies" />
            </div>
            <div className="grid gap-3 md:grid-cols-5 items-stretch">
              <ArchitecturePill title="Identity & lag handling" subtitle="User stitching & time alignment" />
              <ArchitectureArrow />
              <ArchitecturePill title="Attribution & MMM" subtitle="Rule-based + probabilistic models" />
              <ArchitectureArrow />
              <ArchitecturePill title="Executive outputs" subtitle="ROAS, CAC, marginal ROI" />
            </div>

            <ul className="mt-2 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
              <li>• Schema drift management across platforms and campaign structures.</li>
              <li>• Currency and time zone normalization for consistent financial reporting.</li>
              <li>• Time lag alignment between impression, click, and conversion events.</li>
              <li>• Explicit separation between attribution reporting and causal inference.</li>
            </ul>
          </div>
        </section>

        {/* Known limitations & methodology */}
        <section aria-labelledby="limitations" className="rounded-xl bg-card p-6 shadow-sm">
          <div className="space-y-3">
            <h2 id="limitations">Methodology & limitations</h2>
            <p className="text-sm text-muted-foreground max-w-3xl">
              This case study is intentionally honest about what attribution and MMM can and cannot do. The goal is
              decision support, not a single source of truth.
            </p>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <div className="rounded-lg bg-muted/70 p-3">
              • Attribution estimates contribution, it does not prove causation for any given conversion.
            </div>
            <div className="rounded-lg bg-muted/70 p-3">
              • MMM requires sufficiently long, stable time series and can struggle with rapid structural breaks.
            </div>
            <div className="rounded-lg bg-muted/70 p-3">
              • Platform feedback loops (auto-bidding, optimization goals) bias both experiments and models.
            </div>
            <div className="rounded-lg bg-muted/70 p-3">
              • Results should guide expert judgment and scenario planning, not fully replace strategic decisions.
            </div>
          </div>
        </section>

        {/* Footer CTA + disclaimer */}
        <footer className="mb-8 flex flex-col gap-4 border-t pt-6 text-xs text-muted-foreground">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                Want decision-grade attribution for your organization?
              </p>
              <p className="mt-1 text-[11px] max-w-xl">
                I work with B2B and PLG teams to design and implement end-to-end data pipelines, attribution models, and
                MMM that executives actually trust.
              </p>
            </div>
            <a
              href="https://calendly.com"
              target="_blank"
              rel="noreferrer"
              className="self-start md:self-auto"
            >
              <Button size="sm" className="text-xs font-medium">
                Start a conversation
              </Button>
            </a>
          </div>
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between text-[11px]">
            <p>
              This is a reference implementation using synthetic data. No client or proprietary data is used.
            </p>
            <p>Attribution ≠ causation. Use this as a structured lens on trade-offs, not a single source of truth.</p>
          </div>
        </footer>
      </main>
    </div>
  );
};

interface InputSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

const InputSlider = ({ label, value, min, max, step, onChange }: InputSliderProps) => {
  return (
    <div className="space-y-1 rounded-lg border bg-background/80 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{currencyFormatter.format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="mt-1"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{currencyFormatter.format(min)}</span>
        <span>{currencyFormatter.format(max)}</span>
      </div>
    </div>
  );
};

interface OptionTabsProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

const OptionTabs = <T extends string>({ label, value, onChange, options }: OptionTabsProps<T>) => {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <Tabs value={value} onValueChange={(v) => onChange(v as T)} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-muted/70">
          {options.map((opt) => (
            <TabsTrigger key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
};

interface SummaryMetricProps {
  label: string;
  value: string;
  helper: string;
}

const SummaryMetric = ({ label, value, helper }: SummaryMetricProps) => (
  <Card className="border-border/80 bg-background/90 shadow-sm">
    <CardContent className="pt-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
    </CardContent>
  </Card>
);

interface ArchitecturePillProps {
  title: string;
  subtitle: string;
}

const ArchitecturePill = ({ title, subtitle }: ArchitecturePillProps) => (
  <div className="flex flex-col justify-center rounded-xl border bg-background/80 px-3 py-4 text-xs shadow-sm">
    <p className="font-medium text-foreground">{title}</p>
    <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
  </div>
);

const ArchitectureArrow = () => (
  <div className="hidden items-center justify-center md:flex">
    <div className="h-px w-10 bg-border" />
    <div className="-ml-1 h-0 w-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-border" />
  </div>
);

export default Index;
