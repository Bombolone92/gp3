"""Inventory OOXML property declarations from a supplied schema, without bundling it.

This inventories declarations, not renderer support. A manual coverage ledger can
be checked for missing/extra direct property rows with --ledger. The default
type remains CT_SectPr; --type selects another named local complex type.
Use repeatable --ledger-section titles to select tables in a multi-context ledger.
Use --direct-only when child types require a separate imported-schema audit.
"""
import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

XS = '{http://www.w3.org/2001/XMLSchema}'


def inventory(path, schema_type='CT_SectPr', expand_properties=True):
    data = path.read_bytes()
    root = ET.fromstring(data)
    definitions = {(node.tag, node.get('name')): node for node in root}

    def declarations(node, kind, seen=()):
        result = []
        for child in node:
            if child.tag == XS + kind:
                declaration = dict(child.attrib)
                # Imported element/attribute references contribute a direct
                # declaration name. Retain the QName; do not pretend to have
                # resolved its imported type, children or semantics.
                if 'name' not in declaration and declaration.get('ref'):
                    declaration['name'] = declaration['ref'].split(':')[-1]
                if not declaration.get('name'):
                    raise ValueError(f'Unnamed {kind} declaration')
                result.append(declaration)
                continue  # Never traverse an element's nested content here.
            if child.tag in (XS + 'group', XS + 'attributeGroup') and child.get('ref'):
                name = child.get('ref').split(':')[-1]
                key = (child.tag, name)
                if key in seen:
                    raise ValueError(f'Recursive schema group: {name}')
                target = definitions.get(key)
                if target is None:
                    raise ValueError(f'Unresolved local group: {name}')
                result.extend(declarations(target, kind, seen + (key,)))
                continue
            if child.tag == XS + 'extension' and child.get('base'):
                key = (XS + 'complexType', child.get('base').split(':')[-1])
                target = definitions.get(key)
                if target is not None:
                    if key in seen:
                        raise ValueError(f'Recursive base type: {key[1]}')
                    result.extend(declarations(target, kind, seen + (key,)))
            result.extend(declarations(child, kind, seen))
        return result

    section = definitions.get((XS + 'complexType', schema_type))
    if section is None:
        raise ValueError(f'Unknown local complex type: {schema_type}')
    properties = declarations(section, 'element')
    for prop in properties if expand_properties else []:
        key = (XS + 'complexType', prop.get('type', '').split(':')[-1])
        target = definitions.get(key)
        prop['attributes'] = declarations(target, 'attribute') if target is not None else []
        prop['children'] = declarations(target, 'element') if target is not None else []
    names = [prop['name'] for prop in properties]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate direct property declarations')
    return {
        'schema': path.name,
        'targetNamespace': root.get('targetNamespace'),
        'schemaType': schema_type,
        'schemaSha256': hashlib.sha256(data).hexdigest(),
        'boundary': f'{schema_type} direct child declarations and own attributes; ' + ('direct properties expose their attributes and children. ' if expand_properties else 'child types are not expanded. ') + 'Nested child types, imports and vendor extensions require further audit.',
        'properties': properties,
        'attributes': declarations(section, 'attribute'),
    }


def ledger_sections(text, titles):
    if not titles:
        return text
    headings = list(re.finditer(r'^(#{1,6}) ([^\n]+)$', text, re.M))
    selected = []
    for title in titles:
        matches = [i for i, heading in enumerate(headings) if heading[2].strip() == title]
        if len(matches) != 1:
            raise SystemExit(f'Ledger section must identify one heading: {title!r} ({len(matches)} found)')
        index = matches[0]
        heading = headings[index]
        end = next((other.start() for other in headings[index + 1:]
                    if len(other[1]) <= len(heading[1])), len(text))
        selected.append(text[heading.end():end])
    return '\n'.join(selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('schema', type=Path)
    parser.add_argument('--type', dest='schema_type', default='CT_SectPr')
    parser.add_argument('--ledger', type=Path)
    parser.add_argument('--ledger-section', action='append', default=[])
    parser.add_argument('--direct-only', action='store_true')
    args = parser.parse_args()
    if args.ledger_section and not args.ledger:
        parser.error('--ledger-section requires --ledger')
    result = inventory(args.schema, args.schema_type, not args.direct_only)
    if args.ledger:
        text = ledger_sections(args.ledger.read_text(encoding='utf-8'), args.ledger_section)
        rows = re.findall(r'^\| `([A-Za-z0-9]+)` \|', text, re.M)
        expected = {prop['name'] for prop in result['properties']}
        if len(rows) != len(set(rows)) or set(rows) != expected:
            raise SystemExit(f'Ledger mismatch: missing={sorted(expected-set(rows))}, extra={sorted(set(rows)-expected)}, duplicate rows={len(rows)-len(set(rows))}')
        result['ledgerDirectPropertyRowsVerified'] = len(rows)
        if args.ledger_section:
            result['ledgerSectionsVerified'] = args.ledger_section
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
