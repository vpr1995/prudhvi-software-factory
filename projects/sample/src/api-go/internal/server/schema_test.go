package server_test

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// A small checker for the subset of JSON Schema that the contracts package writes into the
// OpenAPI document. It adds no dependency. An unknown keyword is a problem, so a new keyword in
// the contract cannot pass unseen.

type schema = map[string]any

var (
	annotationKeywords = []string{"default", "description", "format", "title", "$schema", "$id"}
	knownKeywords      = []string{
		"type", "properties", "required", "items", "$ref", "const", "enum",
		"minLength", "maxLength", "pattern", "additionalProperties",
	}
)

type node struct {
	value any
	where string
}

type checker struct {
	document schema
}

// validate returns the problems of a decoded JSON value against a schema. An empty list means
// that the value fits.
func validate(document, root schema, value any) []string {
	return checker{document: document}.check(root, node{value: value, where: "$"})
}

func (c checker) resolve(s schema) schema {
	ref, ok := s["$ref"].(string)
	if !ok {
		return s
	}
	name := strings.TrimPrefix(ref, "#/components/schemas/")
	components, _ := c.document["components"].(map[string]any)
	schemas, _ := components["schemas"].(map[string]any)
	resolved, _ := schemas[name].(map[string]any)
	return resolved
}

func (c checker) check(s schema, n node) []string {
	s = c.resolve(s)
	for keyword := range s {
		if !slices.Contains(knownKeywords, keyword) && !slices.Contains(annotationKeywords, keyword) {
			return []string{fmt.Sprintf("%s: the checker does not know the keyword %q", n.where, keyword)}
		}
	}
	if problems := checkType(s, n); len(problems) > 0 {
		return problems
	}
	var problems []string
	if want, ok := s["const"]; ok && n.value != want {
		problems = append(problems, fmt.Sprintf("%s: expected %v", n.where, want))
	}
	if allowed, ok := s["enum"].([]any); ok && !slices.Contains(allowed, n.value) {
		problems = append(problems, fmt.Sprintf("%s: not one of %v", n.where, allowed))
	}
	switch value := n.value.(type) {
	case string:
		problems = append(problems, checkString(s, value, n.where)...)
	case map[string]any:
		problems = append(problems, c.checkObject(s, value, n.where)...)
	case []any:
		if items, ok := s["items"].(map[string]any); ok {
			for index, item := range value {
				problems = append(problems, c.check(items, node{item, fmt.Sprintf("%s[%d]", n.where, index)})...)
			}
		}
	}
	return problems
}

func checkType(s schema, n node) []string {
	want, ok := s["type"].(string)
	if !ok {
		return nil
	}
	var got string
	switch n.value.(type) {
	case map[string]any:
		got = "object"
	case []any:
		got = "array"
	case string:
		got = "string"
	case float64:
		got = "number"
	case bool:
		got = "boolean"
	case nil:
		got = "null"
	}
	if got == want || (got == "number" && want == "integer") {
		return nil
	}
	return []string{fmt.Sprintf("%s: expected %s, got %s", n.where, want, got)}
}

func checkString(s schema, value, where string) []string {
	var problems []string
	length := utf8.RuneCountInString(value)
	if limit, ok := s["minLength"].(float64); ok && float64(length) < limit {
		problems = append(problems, fmt.Sprintf("%s: shorter than %v", where, limit))
	}
	if limit, ok := s["maxLength"].(float64); ok && float64(length) > limit {
		problems = append(problems, fmt.Sprintf("%s: longer than %v", where, limit))
	}
	if pattern, ok := s["pattern"].(string); ok && !regexp.MustCompile(pattern).MatchString(value) {
		problems = append(problems, fmt.Sprintf("%s: does not match %s", where, pattern))
	}
	return problems
}

func (c checker) checkObject(s schema, value map[string]any, where string) []string {
	var problems []string
	required, _ := s["required"].([]any)
	for _, name := range required {
		if _, ok := value[fmt.Sprint(name)]; !ok {
			problems = append(problems, fmt.Sprintf("%s.%v: missing", where, name))
		}
	}
	properties, _ := s["properties"].(map[string]any)
	for name, item := range value {
		property, known := properties[name].(map[string]any)
		switch {
		case known:
			problems = append(problems, c.check(property, node{item, where + "." + name})...)
		case s["additionalProperties"] == false:
			problems = append(problems, fmt.Sprintf("%s.%s: not allowed", where, name))
		}
	}
	return problems
}
