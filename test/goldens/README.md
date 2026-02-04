# Golden tests

These tests are meant to prevent behavior drift for Astra-specific fork changes.

## Format

Each golden file is a markdown document with `INPUT` and `EXPECT` blocks.

Example:

```md
# Case: tone directive injected

## INPUT
/remember: ship it

## EXPECT
- includes: "✅ Added to memory review queue"
- not_includes: "Traceback"
```

Supported EXPECT assertions:
- `includes: "..."`
- `not_includes: "..."`
- `regex: /.../`

These tests are **deterministic**: they do not call external LLMs.
