# Refactor: Share Fretted Instrument Display Configuration

## Summary

All fretted instruments now use one shared display profile. Each defaults to the full `0-24` fretboard and supports the same zoom and segment navigation controls.

## Changes

- `9e8300d` - Show open strings at the fretboard edge.
- `4404aaf` - Refactor shared fretted instrument displays.
- Guitar, bass, ukulele, and cello now share the same range and zoom configuration.
- Piano retains its dedicated keyboard renderer.
- Browser coverage verifies full-range defaults, open strings, zooming, walking, restoration, and desktop/mobile screenshots.

## Testing

- `npm run test:browser -- tests/browser/instrument-displays.spec.ts` - passed, 2 tests.
- `npm run test` - passed, 40 tests.
- `npm run typecheck` - passed.
- `git diff --check` - passed.

## Breaking Changes

None. The fretted instruments now expose more positions by default and use the shared zoom controls.

## Review Checklist

- [ ] Confirm each fretted instrument defaults to `0-24`.
- [ ] Confirm zoom controls expose the same range ladder.
- [ ] Confirm previous/next navigation works at segment boundaries.
- [ ] Confirm open-string notes remain visible at the nut.
- [ ] Confirm piano behavior remains keyboard-specific.
