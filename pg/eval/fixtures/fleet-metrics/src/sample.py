def documented_public(x):
    """Has a docstring."""
    return x + 1

def undocumented_public(x, y):
    x = x + 1  # filler 1
    x = x + 1  # filler 2
    x = x + 1  # filler 3
    x = x + 1  # filler 4
    x = x + 1  # filler 5
    x = x + 1  # filler 6
    x = x + 1  # filler 7
    x = x + 1  # filler 8
    x = x + 1  # filler 9
    x = x + 1  # filler 10
    x = x + 1  # filler 11
    x = x + 1  # filler 12
    x = x + 1  # filler 13
    x = x + 1  # filler 14
    x = x + 1  # filler 15
    x = x + 1  # filler 16
    x = x + 1  # filler 17
    x = x + 1  # filler 18
    x = x + 1  # filler 19
    x = x + 1  # filler 20
    x = x + 1  # filler 21
    x = x + 1  # filler 22
    x = x + 1  # filler 23
    x = x + 1  # filler 24
    x = x + 1  # filler 25
    x = x + 1  # filler 26
    x = x + 1  # filler 27
    x = x + 1  # filler 28
    x = x + 1  # filler 29
    x = x + 1  # filler 30
    x = x + 1  # filler 31
    x = x + 1  # filler 32
    x = x + 1  # filler 33
    x = x + 1  # filler 34
    x = x + 1  # filler 35
    x = x + 1  # filler 36
    x = x + 1  # filler 37
    x = x + 1  # filler 38
    x = x + 1  # filler 39
    x = x + 1  # filler 40
    x = x + 1  # filler 41
    x = x + 1  # filler 42
    x = x + 1  # filler 43
    x = x + 1  # filler 44
    x = x + 1  # filler 45
    x = x + 1  # filler 46
    x = x + 1  # filler 47
    x = x + 1  # filler 48
    x = x + 1  # filler 49
    x = x + 1  # filler 50
    x = x + 1  # filler 51
    x = x + 1  # filler 52
    x = x + 1  # filler 53
    x = x + 1  # filler 54
    x = x + 1  # filler 55
    x = x + 1  # filler 56
    x = x + 1  # filler 57
    x = x + 1  # filler 58
    x = x + 1  # filler 59
    x = x + 1  # filler 60
    x = x + 1  # filler 61
    x = x + 1  # filler 62
    x = x + 1  # filler 63
    x = x + 1  # filler 64
    x = x + 1  # filler 65
    return x

def _private_helper(x):
    return x

def uses_bare_except():
    try:
        risky()
    except:
        pass

def uses_except_exception_pass():
    try:
        risky()
    except Exception:
        pass
