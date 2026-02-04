# Case: memory review command when queue is empty

## INPUT
/memory-review

## EXPECT
- includes: "No memory candidates pending"

# Case: remember command without args

## INPUT
/remember

## EXPECT
- includes: "Usage: /remember"
