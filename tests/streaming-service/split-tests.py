#!/usr/bin/env python3
"""
Script to split test-streaming-e2e.sh into quick and complex test files
"""
import re
import sys

def split_tests():
    # Read the original test file
    with open('test-streaming-e2e.sh', 'r') as f:
        content = f.read()
    
    # Find where tests start
    test_start_match = re.search(r'(^# Test 1:.*)', content, re.MULTILINE)
    if not test_start_match:
        print("Error: Could not find test start")
        sys.exit(1)
    
    test_start_pos = test_start_match.start()
    header = content[:test_start_pos]
    tests_section = content[test_start_pos:]
    
    # Find summary section
    summary_match = re.search(r'^# Summary', tests_section, re.MULTILINE)
    summary_section = tests_section[summary_match.start():] if summary_match else ""
    tests_only = tests_section[:summary_match.start()] if summary_match else tests_section
    
    # Quick tests (REST API only, simple operations)
    quick_test_numbers = {1, 2, 3, 4, 5, 12, 15, 17, 23, 24, 27, 28, 29, 37, 38, 53, 60, 64, 65, 66, 67}
    
    # Extract all test blocks
    # Pattern: # Test N: ... until next # Test or # Summary
    test_pattern = r'(# Test (\d+):.*?)(?=^# Test \d+:|^# Summary|$)'
    test_matches = list(re.finditer(test_pattern, tests_only, re.MULTILINE | re.DOTALL))
    
    quick_blocks = []
    complex_blocks = []
    
    for i, match in enumerate(test_matches):
        test_num = int(match.group(2))
        test_block = match.group(1)
        
        # Check if it uses WebSocket (complex)
        uses_websocket = 'websocket_send' in test_block or 'websocket_wait' in test_block
        
        if test_num in quick_test_numbers and not uses_websocket:
            quick_blocks.append((test_num, test_block))
        else:
            complex_blocks.append((test_num, test_block))
    
    # Sort by test number
    quick_blocks.sort(key=lambda x: x[0])
    complex_blocks.sort(key=lambda x: x[0])
    
    # Create quick test file
    quick_content = header + "\n# ========== QUICK TESTS (REST API Only) ==========\n\n"
    for test_num, test_block in quick_blocks:
        quick_content += test_block + "\n"
    quick_content += summary_section
    
    # Create complex test file
    complex_content = header + "\n# ========== COMPLEX TESTS (WebSocket, Integration) ==========\n\n"
    for test_num, test_block in complex_blocks:
        complex_content += test_block + "\n"
    complex_content += summary_section
    
    # Write files
    with open('test-streaming-quick.sh', 'w') as f:
        f.write(quick_content)
    
    with open('test-streaming-complex.sh', 'w') as f:
        f.write(complex_content)
    
    print(f"✅ Created test-streaming-quick.sh with {len(quick_blocks)} tests")
    print(f"✅ Created test-streaming-complex.sh with {len(complex_blocks)} tests")
    print(f"\nQuick test numbers: {sorted([t[0] for t in quick_blocks])}")
    print(f"Complex test numbers: {sorted([t[0] for t in complex_blocks])}")

if __name__ == '__main__':
    split_tests()
