Get-WmiObject Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine | Format-List
