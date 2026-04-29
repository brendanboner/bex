/**
 * WidgetGrid — renders the appropriate widget component for each widget config.
 */

import type { Widget, UserDashboard } from '@/lib/api';
import { HeadlineWidget } from './HeadlineWidget';
import { TableWidget } from './TableWidget';
import { ChartWidget } from './ChartWidget';
import { ActionsWidget } from './ActionsWidget';
import { StatWidget } from './StatWidget';
import { MultilineChartWidget } from './MultilineChartWidget';
import { MarkdownWidget } from './MarkdownWidget';
import { HeatmapWidget } from './HeatmapWidget';

interface WidgetGridProps {
  dashboard: UserDashboard;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function WidgetGrid({ dashboard, onRefresh, isRefreshing }: WidgetGridProps) {
  const data = (dashboard.lastData ?? {}) as Record<string, unknown>;
  const widgets = dashboard.widgets ?? [];

  if (widgets.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-slate-500 text-sm">No widgets configured for this dashboard.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-min">
      {widgets.map((widget: Widget) => {
        const span = widget.colSpan ?? 1;

        switch (widget.type) {
          case 'headline':
            return (
              <HeadlineWidget
                key={widget.id}
                title={widget.title}
                dataKey={widget.dataKey}
                data={data}
                colSpan={span}
              />
            );
          case 'table':
            return (
              <TableWidget
                key={widget.id}
                title={widget.title}
                dataKey={widget.dataKey}
                columns={widget.columns}
                data={data}
                colSpan={span}
              />
            );
          case 'chart':
            return (
              <ChartWidget
                key={widget.id}
                title={widget.title}
                dataKey={widget.dataKey}
                chartType={widget.chartType}
                xKey={widget.xKey}
                yKey={widget.yKey}
                data={data}
                colSpan={span}
              />
            );
          case 'actions':
            return (
              <ActionsWidget
                key={widget.id}
                widget={widget}
                onRefresh={onRefresh}
                isLoading={isRefreshing}
                colSpan={span}
              />
            );
          case 'stat':
            return (
              <StatWidget
                key={widget.id}
                widget={widget}
                data={data}
                colSpan={span}
              />
            );
          case 'multiline':
            return (
              <MultilineChartWidget
                key={widget.id}
                title={widget.title}
                dataKey={widget.dataKey}
                xKey={widget.xKey}
                yKeys={widget.yKeys}
                data={data}
                colSpan={span}
              />
            );
          case 'markdown':
            return (
              <MarkdownWidget
                key={widget.id}
                title={widget.title}
                dataKey={widget.dataKey}
                data={data}
                colSpan={span}
              />
            );
          case 'heatmap':
            return (
              <HeatmapWidget
                key={widget.id}
                title={widget.title}
                dataKey={widget.dataKey}
                labelKey={widget.labelKey}
                valueKey={widget.valueKey}
                thresholds={widget.thresholds}
                data={data}
                colSpan={span}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
