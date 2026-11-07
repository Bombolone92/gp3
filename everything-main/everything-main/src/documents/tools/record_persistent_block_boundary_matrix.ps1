$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/persistent-block-controls/control.docx'))
$out=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/persistent-block-controls/boundary-matrix'))
[IO.Directory]::CreateDirectory($out)|Out-Null
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null;$results=@()
try{
 foreach($title in @('replace','two-paragraphs','placeholder')){foreach($case in @('join-start','join-end','cross-start','cross-end','split-cross-start','erase-cross-start','split-cross-end')){
  Write-Output ($title+' '+$case+' opening');
  $doc=$word.Documents.Open($source,$false,$true);if($doc.FullName -ne $source){throw 'Wrong document'}
  $control=$doc.SelectContentControlsByTitle($title).Item(1);$s=$control.Range.Start;$e=$control.Range.End;$range=$doc.Range($s,$e);$text=''
  switch($case){
   'erase-cross-start'{$range.SetRange($s-2,$e)}
   'split-cross-end'{$range.SetRange($e-2,$e+2);$text="X`rY"}
   'join-start'{$range.SetRange($s-2,$s)}
   'join-end'{$range.SetRange($e,$e+2)}
   'cross-start'{$range.SetRange($s-2,$s+2);$text='X'}
   'cross-end'{$range.SetRange($e-2,$e+2);$text='X'}
   'split-cross-start'{$range.SetRange($s-2,$s+2);$text="X`rY"}
  }
  Write-Output 'range ready';
  $selected=$range.Text;$before=$doc.Content.Text;$errorText='';try{$range.Text=$text}catch{$errorText=$_.Exception.Message}
  Write-Output 'mutation complete';
  $remainingCount=$doc.SelectContentControlsByTitle($title).Count; Write-Output ('count='+$remainingCount)
  $name=$title+'-'+$case;$destination=[string](Join-Path $out ($name+'.docx')); $doc.SaveAs2($destination,12); Write-Output 'saved'
  $results+=@{name=$name;selected=$selected;replacement=$text;before=$before;after=$doc.Content.Text;error=$errorText;count=$remainingCount;controlText=$(if($remainingCount){$doc.SelectContentControlsByTitle($title).Item(1).Range.Text}else{''})}
  Write-Output ($name+' count='+$remainingCount+' error='+$errorText)
  $doc.Close([ref]0);$doc=$null
 }}
 $converted=[string](Join-Path $out 'placeholder-join-start.docx')
 $doc=$word.Documents.Open($converted,$false,$true);if($doc.FullName -ne $converted){throw 'Wrong converted source'}
 $control=$doc.SelectContentControlsByTitle('placeholder').Item(1)
 $control.Range.Text='Entered';$control.Range.Text=''
 $destination=[string](Join-Path $out 'converted-placeholder-restored.docx')
 $doc.SaveAs2($destination,12);$doc.Close([ref]0);$doc=$null
 $results|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8 (Join-Path $out 'native-results.json')
}finally{try{if($null-ne $doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
