"""Fix Unicode characters in test file"""
import re

with open('comprehensive_system_test.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace all Unicode emoji characters
replacements = {
    '❌': '[FAIL]',
    '✅': '[PASS]',
    '⚠️': '[WARNING]',
    '✓': '[OK]',
    '🎉': '[SUCCESS]'
}

for old, new in replacements.items():
    content = content.replace(old, new)

with open('comprehensive_system_test.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed Unicode characters")

