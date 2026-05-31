package cards

import (
	"database/sql/driver"
	"fmt"
)

// JSONRaw holds a raw JSON value from a MySQL JSON column. It's []byte on
// the wire but emits as a JSON value (NOT a base64-encoded string) when
// marshaled. NULL columns scan to a nil slice and marshal as JSON `null`.
//
// We use this instead of json.RawMessage because the latter has no
// sql.Scanner implementation in the stdlib and falls back to a reflection
// path that doesn't always handle NULL cleanly with the mysql driver.
type JSONRaw []byte

// Scan implements sql.Scanner.
func (j *JSONRaw) Scan(src any) error {
	if src == nil {
		*j = nil
		return nil
	}
	switch v := src.(type) {
	case []byte:
		// Copy — the driver may reuse the underlying buffer.
		buf := make([]byte, len(v))
		copy(buf, v)
		*j = buf
		return nil
	case string:
		*j = []byte(v)
		return nil
	default:
		return fmt.Errorf("JSONRaw: unsupported scan type %T", src)
	}
}

// Value implements driver.Valuer so this type can also be used in inserts.
func (j JSONRaw) Value() (driver.Value, error) {
	if len(j) == 0 {
		return nil, nil
	}
	return []byte(j), nil
}

// MarshalJSON emits the stored bytes verbatim, so a JSON-shaped value lands
// in API responses without being re-encoded.
func (j JSONRaw) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return j, nil
}
