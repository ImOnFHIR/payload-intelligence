// SPDX-License-Identifier: Apache-2.0

import { doctorPassed, formatDoctorReport, runDoctor, type DoctorTarget } from './mcp-doctor-lib.js'

const requested = (process.argv[2] ?? 'both').toLowerCase()
const target: DoctorTarget | undefined = requested === 'codex' || requested === 'claude' || requested === 'both'
  ? requested
  : undefined

if (!target) {
  process.stderr.write('Usage: npm run mcp:doctor -- codex|claude|both\n')
  process.exitCode = 2
} else {
  const report = await runDoctor(target)
  process.stdout.write(formatDoctorReport(report))
  if (!doctorPassed(report)) process.exitCode = 1
}
