# Dot-source before launching the deploy server. Its game processes inherit this
# Windows job, sharing ONE CPU budget across all worlds rather than per process.
[CmdletBinding()]
param([ValidateRange(1,100)][int]$Percent = 50,[string]$Name = 'DauntlessGermanyCPU',[switch]$VerifyOnly)
$ErrorActionPreference='Stop'
if (-not ('DauntlessCpuBudget' -as [type])) {
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DauntlessCpuBudget {
    [StructLayout(LayoutKind.Sequential)] public struct Rate { public uint Flags; public uint Value; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref Rate info,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out Rate info,uint size,IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    static IntPtr handle;
    public static uint Apply(string name,uint percent,bool verifyOnly) {
        handle=CreateJobObject(IntPtr.Zero,name);
        if(handle==IntPtr.Zero)throw new Win32Exception();
        var info=new Rate { Flags=5, Value=percent*100 }; // ENABLE | HARD_CAP
        if(!verifyOnly) {
            if(!SetInformationJobObject(handle,15,ref info,8))throw new Win32Exception();
            if(!AssignProcessToJobObject(handle,GetCurrentProcess()))throw new Win32Exception();
        }
        if(!QueryInformationJobObject(handle,15,out info,8,IntPtr.Zero))throw new Win32Exception();
        if(info.Flags!=5 || info.Value!=percent*100)throw new InvalidOperationException("CPU job budget mismatch");
        return info.Value;
    }
}
'@
}
$rate=[DauntlessCpuBudget]::Apply($Name,[uint32]$Percent,$VerifyOnly.IsPresent)
Write-Output "Windows aggregate CPU hard cap verified: $($rate/100)%"
