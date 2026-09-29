# Survey

Survey opens from the site instrument list or the Survey tab of an instrument. All instruments in a site share the same reference points, draft, processed plan, and actual positions. The existing reports module storage and revision checks persist these records under `site.survey`. Reference photo bytes use the existing module-file storage; the site state contains metadata only.

## Coordinate and alignment rules

- Datum: WGS84. Projection uses Proj4js, UTM northern hemisphere.
- Zone follows the site's longitude: longitude greater than 102 uses 48N; otherwise 47N. Site longitude is required and must be within the two supported zones.
- Lat/Long to N/E and N/E to Lat/Long use the same site zone. Elevation is entered separately and is not transformed.
- STA `1+250` means 1250 metres. Coordinates are projected along the straight reference line, starting at the lower STA. One STA unit is one metre; the program does not stretch STA to force a match to a conflicting second reference.
- The screen shows both UTM distance and STA difference so the operator can verify inconsistent reference data. Points outside the reference STA range are marked as extrapolated.
- Facing increasing STA, the user selects whether left means U/S or D/S. Positive Offset is perpendicular grid distance in metres. CL requires zero Offset.
- Actual values are kept separately from planned values. A change in STA, Offset, or U/D produces a warning. Processing a revised plan does not overwrite recorded actual positions.

## CSV

Download the sample from Survey → แผนการสำรวจ. Columns: `Instrument ID,Instrument Type,STA,Offset,U/D`.

Imports append to the draft and are validated entirely before insertion. IDs must be unique in the draft. Instrument Type matches the existing instrument type list without case sensitivity. U/D accepts U, D, and CL. Click Process to update map positions.

## Verification and release

Survey calculation tests cover both UTM zones, inverse conversions, STA parsing, reversed references, U/D orientation, CL, and changed actual alignment. Browser checks cover creating references with either coordinate format, processing a plan, CSV import, multiple compressed photos, actual alignment warnings, password-dialog foreground placement, and responsive layouts at 1440px and 390px.

Owner bill popups now request all matching bill IDs separately from paginated rows, with a server-side net total using the same filters. A browser fixture with 27 bills verifies that the 20-row table can browse all 27 bills.

This change is prepared locally only. NAS deployment is pending the user's later instruction.
