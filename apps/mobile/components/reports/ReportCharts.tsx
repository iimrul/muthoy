import { memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { DailyTrendPoint, MonthlyReportSnapshot } from '../../db/reports';

function TrendChartBase({ data }: { data: DailyTrendPoint[] }) {
  if (data.length === 0) return null;
  const width = 320; const height = 160; const bottom = 132; const top = 10;
  const values = data.map((point) => point.sales);
  const minimum = Math.min(0, ...values); const maximum = Math.max(1, ...values); const span = maximum - minimum;
  const x = (index: number) => 8 + (index / Math.max(data.length - 1, 1)) * 304;
  const y = (value: number) => top + ((maximum - value) / span) * (bottom - top);
  const line = data.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.sales)}`).join(' ');
  const area = `${line} L ${x(data.length - 1)} ${bottom} L ${x(0)} ${bottom} Z`;
  const labelStep = data.length <= 7 ? 1 : Math.ceil(data.length / 5);
  return (
    <Svg viewBox={`0 0 ${width} ${height}`} width="100%" height={160} accessibilityLabel="Sales trend chart">
      <Path d={area} fill="#059669" fillOpacity={0.12} />
      <Path d={line} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((point, index) => <Circle key={point.date} cx={x(index)} cy={y(point.sales)} r={3} fill="#FFFFFF" stroke="#059669" strokeWidth={2} />)}
      {data.map((point, index) => index % labelStep === 0 || index === data.length - 1 ? (
        <SvgText key={`label-${point.date}`} x={x(index)} y={154} textAnchor="middle" fontSize={9} fill="#9CA3AF">
          {point.date.slice(5)}
        </SvgText>
      ) : null)}
    </Svg>
  );
}
export const TrendChart = memo(TrendChartBase);

function DonutChartBase({ cash, credit }: { cash: number; credit: number }) {
  const cashValue = Math.max(0, cash); const creditValue = Math.max(0, credit); const total = cashValue + creditValue;
  if (total === 0) return null;
  const circumference = 2 * Math.PI * 34; const cashLength = circumference * cashValue / total;
  return (
    <View className="items-center">
      <Svg viewBox="0 0 100 100" width={96} height={96} accessibilityLabel="Payment breakdown chart">
        <Circle cx={50} cy={50} r={34} fill="none" stroke="#D97706" strokeWidth={14} />
        <Circle cx={50} cy={50} r={34} fill="none" stroke="#059669" strokeWidth={14}
          strokeDasharray={`${cashLength} ${circumference - cashLength}`} strokeLinecap="round" rotation={-90} origin="50,50" />
      </Svg>
    </View>
  );
}
export const DonutChart = memo(DonutChartBase);

function SixMonthBarsBase({ data }: { data: MonthlyReportSnapshot['sixMonthTrend'] }) {
  const width = 320; const height = 176; const baseline = 145;
  const maximum = Math.max(1, ...data.flatMap((row) => [Math.max(0, row.sales), Math.max(0, row.profit)]));
  const group = 50; const barWidth = 15;
  return (
    <Svg viewBox={`0 0 ${width} ${height}`} width="100%" height={176} accessibilityLabel="Six month sales and profit chart">
      {data.map((row, index) => {
        const x = 12 + index * group; const salesHeight = Math.max(2, Math.max(0, row.sales) / maximum * 120);
        const profitHeight = Math.max(2, Math.max(0, row.profit) / maximum * 120);
        return (
          <G key={row.yearMonth}>
            <Rect x={x} y={baseline - salesHeight} width={barWidth} height={salesHeight} rx={4} fill="#A7F3D0" />
            <Rect x={x + 17} y={baseline - profitHeight} width={barWidth} height={profitHeight} rx={4} fill={row.profit < 0 ? '#B91C1C' : '#059669'} />
            <SvgText x={x + 16} y={164} textAnchor="middle" fontSize={9} fill="#6B7280">{row.yearMonth.slice(5)}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
export const SixMonthBars = memo(SixMonthBarsBase);
