/** `KidsDash-Data` for prod, `KidsDash-dev-Data` for any other stage. */
export function stackName(stage: string, part: string): string {
  if (!/^[a-z][a-z0-9]{0,15}$/.test(stage)) {
    throw new Error(`Stage "${stage}" must be lowercase letters and digits`);
  }
  return stage === "prod" ? `KidsDash-${part}` : `KidsDash-${stage}-${part}`;
}
