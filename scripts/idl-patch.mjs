export function patchIdlForValidation(idl) {
  const withPartial = idl.includes('@partial\nservice AgentTrustLayer@')
    ? idl
    : idl.replace('service AgentTrustLayer@', '@partial\nservice AgentTrustLayer@');

  const lines = withPartial.split(/\r?\n/);
  const output = [];
  let inFunctions = false;
  let inEvents = false;
  let nextEntryId = 0;
  let nextEventId = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const leadingSpaces = line.length - trimmed.length;

    if (trimmed === 'events {') {
      inEvents = true;
      output.push(line);
      continue;
    }
    if (trimmed === 'functions {') {
      inFunctions = true;
      output.push(line);
      continue;
    }
    if (inEvents && trimmed === '}') {
      inEvents = false;
    }
    if (inFunctions && trimmed === '}') {
      inFunctions = false;
    }
    if (
      inEvents &&
      leadingSpaces === 8 &&
      !trimmed.startsWith('}') &&
      (trimmed.endsWith('{') || trimmed.endsWith(','))
    ) {
      output.push(`        @entry_id: ${nextEventId}`);
      nextEventId += 1;
    }
    if (
      inFunctions &&
      leadingSpaces === 8 &&
      trimmed.includes('(') &&
      trimmed.endsWith(';')
    ) {
      output.push(`        @entry_id: ${nextEntryId}`);
      nextEntryId += 1;
    }
    output.push(line);
  }

  return output.join('\n');
}
