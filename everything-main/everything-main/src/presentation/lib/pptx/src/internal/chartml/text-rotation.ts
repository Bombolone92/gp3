// Native ChartML automatic text orientation. Excelize emits this as its
// default; native chart editing distinguishes automatic orientation from
// explicit angles in [-90, 90]. Keep the native state separate from degrees.
// https://github.com/xuri/excelize/blob/master/drawing.go (drawPlotAreaTxPr)
export const CHART_AUTO_ROTATION = -60000000;
