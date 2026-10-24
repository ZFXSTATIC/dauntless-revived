# Server locale and Behemoth part breaks

Players reported Gnasher/Embermane parts staying attached after rewarded breaks on hosted servers, while private builds worked. The supplied upstream diagnosis identified decimal-comma server cultures misreading decimal-point values. That is distinct from inventory reward validation.

The current 1.4.4 GetCommandLineHook replaces the real command line with a fixed string. Adding -CULTURE=en-US only in the deployer cannot reach this path. ServerLocale.h adds it to the replacement string and configures both the initializing thread and global CRT locale to C immediately before InitServerHooks(). The client branch is unchanged. Keep this build's existing hook RVA 0x1D06D40; the supplied 1.6.2 example's 0x1EBF560 is not portable to this binary.

tests/server-locale.cpp reproduces incomplete parsing of 105.6 under French, German and Italian CRT locales, then verifies complete parsing after initialization on the current thread and a newly created thread. It also verifies the replacement command line contains the culture flag. The Release x64 DLL builds with MSVC 14.44.35207.

Observed hosted Windows settings: Germany de-DE with decimal comma; main and US en-US; new EU user culture en-US with system locale de-DE. These settings support the locale diagnosis, but are not a capture of the game's previous runtime locale. Do not claim every reported visual failure is proven fixed solely from locale tests.

Deployment must back up the DLL/configuration and reject an unexpected current DLL hash, preserving other developers' changes. Replace the disk image for new workers without terminating active hunts. New diagnostic logs contain server_locale numeric=C commandline_culture=en-US when CRT initialization succeeds. Existing processes retain the old image until naturally replaced. Validate a fresh Gnasher/Embermane tail break in a hosted hunt before closing the visual report.

The SDK's CurrentBreakStage and PartSevered replication callbacks remain allowed by the debug RPC guard. No reward, ownership, matchmaking, or disconnect behavior is changed. Unused diagnostic experiments were kept outside the repository; the locale patch does not add per-event tracing or force every part to sever.

Rollout: main, US and Germany disk DLLs were replaced after backing up the prior DLL and configuration. New SHA256: BEB17A8F962B93AF482C6935FB781ABA65ED299CC972813DB8F662C35EDA3C28. No game process was restarted. The additional EU host became unreachable over SSH directly and through main; its rollout is not confirmed. Germany rejected an extra canary with capacity_unavailable/cpu; the admission guard was preserved. A hosted tail-break result remains unverified. tools/Deploy-NativeLocale.ps1 rejects any prior DLL other than the reviewed 87AECD7... build and backs up before replacement.

Live verification after rollout: a newly started US process logged server_locale numeric=C commandline_culture=en-US and one connected/owned/open network connection. Main/Germany disk hashes match the candidate; no fresh marked process was observed during that check. The extra EU host still timed out on a final direct SSH retry. Source commit 9245d3f was pushed to fix/ramsgate-capacity-and-account-recovery; launcher news separately reports the limited rollout and remaining tail-break confirmation.
