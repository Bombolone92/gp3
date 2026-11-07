$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/persistent-block-controls/boundary-matrix/replace-erase-cross-start.docx'))
$out=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/empty-inline-controls/native'))
[IO.Directory]::CreateDirectory($out)|Out-Null
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null;$results=@()
try {foreach($case in @('inside','outside-before','outside-after','delete-previous','delete-next','split','clear-after-entry')) {
 $doc=$word.Documents.Open($source,$false,$true);if($doc.FullName -ne $source){throw 'Wrong source'}
 $cc=$doc.SelectContentControlsByTitle('replace').Item(1);$s=$cc.Range.Start;$e=$cc.Range.End;$before=$doc.Content.Text;$errorText=''
 try {switch($case) {
 'inside' {$cc.Range.Text='Typed'}
 'outside-before' {$doc.Range($s-1,$s-1).Text='Typed'}
 'outside-after' {$doc.Range($e+1,$e+1).Text='Typed'}
 'delete-previous' {$doc.Range($s-2,$s-1).Text=''}
 'delete-next' {$doc.Range($e+1,$e+2).Text=''}
 'split' {$cc.Range.Text="X`rY"}
 'clear-after-entry' {$cc.Range.Text='Typed';$cc.Range.Text=''}
 }}catch{$errorText=$_.Exception.Message}
 $count=$doc.SelectContentControlsByTitle('replace').Count
 $results+=@{name=$case;start=$s;end=$e;before=$before;after=$doc.Content.Text;error=$errorText;count=$count;text=$(if($count){$doc.SelectContentControlsByTitle('replace').Item(1).Range.Text}else{''})}
 $destination=[string](Join-Path $out ($case+'.docx'));$doc.SaveAs2($destination,12);Write-Output ($case+' count='+$count+' error='+$errorText)
 $doc.Close([ref]0);$doc=$null
 }
 $results|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8 (Join-Path $out 'native-results.json')
}finally{try{if($null-ne $doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
