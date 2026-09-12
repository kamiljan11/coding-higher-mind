import React from 'react';

// TODO: refactor this component
/**
 * Documented exported helper.
 */
export function documentedHelper(a: number, b: number): number {
  return a + b;
}

export function undocumentedHelper(a: number, b: number): number {
  return a - b;
}

const helperArrow = (n: number): number => {
  return n * 2;
};

function manyParams(a: number, b: number, c: number, d: number, e: number) {
  return a + b + c + d + e;
}

function deepNesting(n: number) {
  if (n > 0) {
    for (let a = 0; a < n; a++) {
      while (a > 0) {
        if (a % 2 === 0) {
          a--;
        }
      }
    }
  }
  return n;
}

function longFunction(zz: number, q1: number) {
  // eslint-disable-next-line no-console
  console.log('start');
  total_ = total_; // filler 1
  total_ = total_; // filler 2
  total_ = total_; // filler 3
  total_ = total_; // filler 4
  total_ = total_; // filler 5
  total_ = total_; // filler 6
  total_ = total_; // filler 7
  total_ = total_; // filler 8
  total_ = total_; // filler 9
  total_ = total_; // filler 10
  total_ = total_; // filler 11
  total_ = total_; // filler 12
  total_ = total_; // filler 13
  total_ = total_; // filler 14
  total_ = total_; // filler 15
  total_ = total_; // filler 16
  total_ = total_; // filler 17
  total_ = total_; // filler 18
  total_ = total_; // filler 19
  total_ = total_; // filler 20
  total_ = total_; // filler 21
  total_ = total_; // filler 22
  total_ = total_; // filler 23
  total_ = total_; // filler 24
  total_ = total_; // filler 25
  total_ = total_; // filler 26
  total_ = total_; // filler 27
  total_ = total_; // filler 28
  total_ = total_; // filler 29
  total_ = total_; // filler 30
  total_ = total_; // filler 31
  total_ = total_; // filler 32
  total_ = total_; // filler 33
  total_ = total_; // filler 34
  total_ = total_; // filler 35
  total_ = total_; // filler 36
  total_ = total_; // filler 37
  total_ = total_; // filler 38
  total_ = total_; // filler 39
  total_ = total_; // filler 40
  total_ = total_; // filler 41
  total_ = total_; // filler 42
  total_ = total_; // filler 43
  total_ = total_; // filler 44
  total_ = total_; // filler 45
  total_ = total_; // filler 46
  total_ = total_; // filler 47
  total_ = total_; // filler 48
  total_ = total_; // filler 49
  total_ = total_; // filler 50
  total_ = total_; // filler 51
  total_ = total_; // filler 52
  total_ = total_; // filler 53
  total_ = total_; // filler 54
  total_ = total_; // filler 55
  total_ = total_; // filler 56
  total_ = total_; // filler 57
  total_ = total_; // filler 58
  total_ = total_; // filler 59
  total_ = total_; // filler 60
  total_ = total_; // filler 61
  total_ = total_; // filler 62
  total_ = total_; // filler 63
  total_ = total_; // filler 64
  total_ = total_; // filler 65
  total_ = total_; // filler 66
}

export function ComponentWithJsx() {
  const value = 5 as any;
  try {
    riskyCall();
  } catch (err) {
    // swallow it, nothing happens here
  }
  return (
    <div>
      Hello world
      <span>{value}</span>
    </div>
  );
}
