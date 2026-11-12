/** Lit le JSON d'une réponse sans crasher si le corps est vide (coupure, délai dépassé...). */
export async function readJson<T = any>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}
