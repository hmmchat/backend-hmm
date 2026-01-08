# Dare Flow - Detailed Explanation

## Core Concept

**The dare list is always the same.** Users can assign the same dare multiple times. There's no concept of "completing" a dare from the list - each dare assignment is a separate transaction with its own payment flow.

## Payment Flow (50/50 Split)

### Step-by-Step:

1. **View Dare** (Optional - Real-time Sync)
   - User browses through dares
   - Other participants see the same dare in real-time
   - Status: `"viewing"`

2. **Assign Dare**
   - User selects a dare and assigns it to another participant
   - Status: `"assigned"`
   - No payment yet

3. **Send Dare with Gift**
   - User selects a gift (with diamond cost)
   - **50% of the gift value is immediately transferred** to the assigned user
   - Status: `"sent"`
   - `firstPaymentSent = true`
   - Example: 50 diamonds gift = 2500 coins (50% of 5000) transferred now

4. **Mark Dare Done**
   - Assigned user indicates they completed the dare
   - Status: `"done"`
   - Still only 50% paid

5. **Confirm Dare Complete**
   - Original user confirms the dare was completed
   - **Remaining 50% is transferred** to the assigned user
   - Status: `"confirmed"`
   - `secondPaymentSent = true`
   - Example: Remaining 2500 coins transferred now

## What is a "Pending" Dare?

A "pending" dare is a dare record where:
- **50% payment was made** (status = `"sent"` or `"done"`)
- **Remaining 50% has NOT been paid** (`secondPaymentSent = false`)

This is a **payment state**, not about the dare list itself.

### Example of Pending Dare:

```
Room has 3 users: A, B, C

1. User A assigns "dare-1" to User B
2. User A sends dare-1 with 50-diamond gift
   → Status: "sent"
   → 2500 coins (50%) transferred to User B ✅
   → secondPaymentSent: false ❌

3. User B marks dare as done
   → Status: "done"
   → Still only 2500 coins paid ✅
   → secondPaymentSent: false ❌ (still pending)

4. Room ends (User A left before confirming)
   → Dare status changed to "cancelled"
   → User B keeps the 2500 coins already paid
   → Remaining 2500 coins will never be paid
```

## Key Points

1. **Dare List Doesn't Change**: The list of available dares is static. Users can repeat any dare.
2. **Each Assignment is Separate**: Assigning "dare-1" multiple times creates multiple records.
3. **Payment State**: "Pending" = payment incomplete, not about the dare being "complete"
4. **50% Stays**: If room ends early, the 50% already paid stays with the receiver (no refund)
5. **Cleanup**: When room ends, pending dares (50% paid, not confirmed) are marked "cancelled"

## Edge Case: Room Ends Early

If a room ends before a dare is fully paid:
- Dares with status `"sent"` or `"done"` but `secondPaymentSent=false` are marked `"cancelled"`
- The 50% already paid remains with the receiver
- This prevents "stuck" dares where payment can never complete

## Status Flow Diagram

```
viewing → assigned → sent → done → confirmed
                ↓        ↓     ↓
             (no pay)  (50%) (50%) (100%)
```

Or if room ends:
```
viewing → assigned → sent → cancelled
                              (50% stays, 50% lost)
```

