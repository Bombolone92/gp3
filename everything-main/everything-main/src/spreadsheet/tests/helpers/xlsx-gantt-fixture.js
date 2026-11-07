import { otherProgramsXlsx } from './xlsx-fixture.js';

/** Small Excel-authored schedule: relative names, overlapping rules and fixed progress limits. */
export function ganttXlsx() {
  const fill = rgb => `<dxf><fill><patternFill><bgColor rgb="FF${rgb}"/></patternFill></fill></dxf>`;
  return otherProgramsXlsx({
    sheetNames: ['Schedule'],
    styles: {
      fonts: ['<font><name val="Arial Black"/><sz val="40"/><b/><color rgb="FF1363DF"/></font>'],
      fills: ['<fill><patternFill patternType="solid"><fgColor theme="0" tint="-0.05"/></patternFill></fill>'],
      cellXfs: [
        '<xf fontId="1" fillId="0" borderId="0"><alignment horizontal="left"/></xf>',
        '<xf fontId="0" fillId="2" borderId="0"><alignment horizontal="center" vertical="center"/></xf>',
      ],
    },
    sheetXml: { Schedule: {
      head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="2.75"/><col min="9" max="16" width="2.75"/></cols>',
      rows: '<row r="1" ht="90"><c r="B1" s="1" t="str"><v>Project schedule</v></c><c r="Q1"><f>TODAY()</f><v>46281</v></c></row>'
        + '<row r="5" ht="15">' + ['I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'].map((c, i) => `<c r="${c}5" s="2"><v>${46279 + i}</v></c>`).join('') + '</row>'
        + '<row r="9" ht="30"><c r="D9"><v>0.5</v></c><c r="E9"><v>46281</v></c><c r="F9"><v>46284</v></c></row>'
        + '<row r="10" ht="30"><c r="D10"><v>0.6</v></c><c r="E10"><v>46284</v></c><c r="F10"><v>46286</v></c></row>',
      // Deliberately out of priority order. The today border and task fill both apply.
      tail: '<conditionalFormatting sqref="D9:D10"><cfRule type="dataBar" priority="4"><dataBar><cfvo type="num" val="0"/><cfvo type="num" val="1"/><color theme="0"/></dataBar></cfRule></conditionalFormatting>'
        + '<conditionalFormatting sqref="I9:P10"><cfRule type="expression" dxfId="1" priority="2"><formula>AND(task_start&lt;=I$5,ROUNDDOWN((task_end-task_start+1)*task_progress,0)+task_start-1&gt;=I$5)</formula></cfRule>'
        + '<cfRule type="expression" dxfId="2" priority="3" stopIfTrue="1"><formula>AND(task_end&gt;=I$5,task_start&lt;J$5)</formula></cfRule></conditionalFormatting>'
        + '<conditionalFormatting sqref="I5:P10 I9:P10"><cfRule type="expression" dxfId="0" priority="1"><formula>AND(TODAY()&gt;=I$5,TODAY()&lt;J$5)</formula></cfRule></conditionalFormatting>',
    } },
    patch: {
      '/xl/workbook.xml': xml => xml.replace('</workbook>', '<definedNames><definedName name="task_start" localSheetId="0">Schedule!$E1</definedName><definedName name="task_end" localSheetId="0">Schedule!$F1</definedName><definedName name="task_progress" localSheetId="0">Schedule!$D1</definedName></definedNames></workbook>'),
      '/xl/styles.xml': xml => xml.replace(/<font>[\s\S]*?<\/font>/, '<font><name val="Arial"/><sz val="11"/><color theme="1"/></font>')
        .replace(/<dxfs[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/, '<dxfs count="3"><dxf><border><left style="thin"><color rgb="FFFF00FF"/></left><right style="thin"><color rgb="FFFF00FF"/></right></border></dxf>' + fill('E0D4FD') + fill('A37EFA') + '</dxfs>'),
    },
  });
}
