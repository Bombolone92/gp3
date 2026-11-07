# Call the reference application's fixed-format method without PowerShell's dynamic COM call site.
# Callers must resolve and guard the exact already-opened owned document.
# This helper never opens, saves, closes or quits a document/application.
if(-not ('OwnedWordPdfExport' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Globalization;
public static class OwnedWordPdfExport {
 public static void Export(object document, string destination) {
  if(document == null || !Marshal.IsComObject(document))
   throw new ArgumentException("Expected an already-owned reference COM document");
  if(String.IsNullOrEmpty(destination) || !Path.IsPathRooted(destination)
   || !String.Equals(Path.GetFullPath(destination),destination,StringComparison.OrdinalIgnoreCase)
   || !destination.EndsWith(".pdf",StringComparison.OrdinalIgnoreCase)
   || File.Exists(destination) || Directory.Exists(destination))
   throw new ArgumentException("Expected a fresh absolute PDF destination");
  document.GetType().InvokeMember("ExportAsFixedFormat",
   BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding,
   null,document,new object[]{destination,17},CultureInfo.InvariantCulture);
  if(!File.Exists(destination)) throw new IOException("The reference application returned without a PDF");
 }
}
'@
}
