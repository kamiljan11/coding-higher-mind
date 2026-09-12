export async function charge(amountIsk: number): Promise<boolean> {
  try {
    await Promise.resolve(amountIsk);
    return true;
  } catch (error) {
    return false;
  }
}
