"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface TrendPoint {
  periodKey: string;
  employeeScore: number | null;
  peerMedian: number | null;
}

export function TrendChartClient({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="periodKey" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="employeeScore"
          name="Employee"
          stroke="#4f46e5"
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="peerMedian"
          name="Peer Median"
          stroke="#9ca3af"
          strokeDasharray="4 4"
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
