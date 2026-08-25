"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";

export function RadarChartClient({ data }: { data: { dimension: string; score: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <RadarChart data={data} outerRadius="75%">
        <PolarGrid />
        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} />
        <Radar name="Score" dataKey="score" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.35} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
