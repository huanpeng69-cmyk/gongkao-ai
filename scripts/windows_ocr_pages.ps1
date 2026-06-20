param(
  [Parameter(Mandatory = $true)]
  [string]$InputDir,

  [Parameter(Mandatory = $true)]
  [string]$OutputJsonl,

  [string]$Language = "zh-Hans-CN"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

function Await-WinRt($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait() | Out-Null
  return $task.Result
}

function Get-PageNumber([string]$BaseName) {
  $match = [regex]::Match($BaseName, "\d+")
  if ($match.Success) {
    return [int]$match.Value
  }
  return 0
}

$inputPath = (Resolve-Path -LiteralPath $InputDir).Path
$outputParent = Split-Path -Parent $OutputJsonl
if ($outputParent -and -not (Test-Path -LiteralPath $outputParent)) {
  New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
}

$lang = [Windows.Globalization.Language]::new($Language)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) {
  throw "OCR language is not available: $Language"
}

$writer = [System.IO.StreamWriter]::new($OutputJsonl, $false, [System.Text.UTF8Encoding]::new($false))
try {
  $files = Get-ChildItem -LiteralPath $inputPath -Filter "*.png" | Sort-Object Name
  foreach ($file in $files) {
    try {
      Write-Host ("OCR {0}" -f $file.Name)
      $storageFile = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file.FullName)) ([Windows.Storage.StorageFile])
      $stream = Await-WinRt ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      try {
        $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $lines = @($result.Lines | ForEach-Object { $_.Text })
        $payload = [ordered]@{
          page = Get-PageNumber $file.BaseName
          file = $file.Name
          text = ($lines -join "`n")
        }
      } finally {
        if ($stream -ne $null) {
          $stream.Dispose()
        }
      }
    } catch {
      $payload = [ordered]@{
        page = Get-PageNumber $file.BaseName
        file = $file.Name
        text = ""
        error = $_.Exception.Message
      }
    }
    $writer.WriteLine(($payload | ConvertTo-Json -Compress))
    $writer.Flush()
  }
} finally {
  $writer.Dispose()
}
