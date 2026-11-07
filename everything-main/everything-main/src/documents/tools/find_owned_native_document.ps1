# Resolve an already-open exact document through the Running Object Table.
# Unlike BindToMoniker, GetObject cannot open an unregistered document.
if(-not ('OwnedWordDocumentRot' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class OwnedWordDocumentRot {
 [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int reserved, out IRunningObjectTable rot);
 [DllImport("ole32.dll")] static extern int CreateBindCtx(int reserved, out IBindCtx ctx);
 public static object Find(string path) {
  IRunningObjectTable rot=null; IBindCtx ctx=null; IEnumMoniker entries=null;
  try {
   Marshal.ThrowExceptionForHR(GetRunningObjectTable(0,out rot));
   Marshal.ThrowExceptionForHR(CreateBindCtx(0,out ctx));
   rot.EnumRunning(out entries);
   var current=new IMoniker[1];
   while(entries.Next(1,current,IntPtr.Zero)==0) {
    try {
     string name; current[0].GetDisplayName(ctx,null,out name);
     if(String.Equals(name,path,StringComparison.OrdinalIgnoreCase)||String.Equals(name,"!"+path,StringComparison.OrdinalIgnoreCase)) {
      object value;rot.GetObject(current[0],out value);return value;
     }
    } catch(COMException) {} finally {Marshal.ReleaseComObject(current[0]);}
   }
   return null;
  } finally {
   if(entries!=null)Marshal.ReleaseComObject(entries);
   if(ctx!=null)Marshal.ReleaseComObject(ctx);
   if(rot!=null)Marshal.ReleaseComObject(rot);
  }
 }
}
'@
}
function Find-OwnedWordDocument([string]$Path) {
 $resolved=[IO.Path]::GetFullPath($Path)
 $document=[OwnedWordDocumentRot]::Find($resolved)
 if(-not $document){throw 'The exact document is not registered as open. Use the document opener first; nothing was opened implicitly.'}
 if(-not [string]::Equals($document.FullName,$resolved,[StringComparison]::OrdinalIgnoreCase)){
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)
  throw 'The registered object did not identify the exact requested document.'
 }
 return $document
}
