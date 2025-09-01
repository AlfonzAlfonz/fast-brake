#!/usr/bin/env bun
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { detect, Detector } from 'fast-brake';
import { createESVersionPlugin } from 'fast-brake/plugins/esversion';
import { createBrowserlistPlugin } from 'fast-brake/plugins/browserlist';
import { detectPlugin } from 'fast-brake/plugins/detect';
import * as babel from '@babel/parser';
import * as acorn from 'acorn';
import * as esprima from 'esprima';
import * as espree from 'espree';
import { parse as meriyahParse } from 'meriyah';
import { parse as cherowParse } from 'cherow';
import { readFileSync } from 'fs';

const ROOT_DIR = join(import.meta.dir, '../../..');

interface BenchmarkResult {
  name: string;
  time: number;
  opsPerSec: number;
  relative: number;
  accuracy: string;
}

interface BenchmarkSet {
  name: string;
  fileSize: number;
  results: BenchmarkResult[];
}

function loadTestCases() {
  const fixturesDir = join(ROOT_DIR, 'tests/fixtures');
  const cases = [
    {
      name: 'ES5 (Legacy)',
      code: readFileSync(join(fixturesDir, 'es5.js'), 'utf-8'),
    },
    {
      name: 'ES2015 (Modern)',
      code: readFileSync(join(fixturesDir, 'es2015.js'), 'utf-8'),
    },
    {
      name: 'ES2022 (Latest)',
      code: readFileSync(join(fixturesDir, 'es2022.js'), 'utf-8'),
    },
  ];

  const largeCode = cases[1].code.repeat(100);
  cases.push({
    name: 'Large File (100x)',
    code: largeCode,
  });

  return cases;
}

const parsers = [
  {
    name: 'fast-brake',
    fn: async (code: string) => await detect(code),
    accuracy: 'none',
  },
  {
    name: 'fast-brake (es5 only)',
    fn: async (code: string) => {
      const detector = new Detector();
      await detector.initialize(createESVersionPlugin('es5'));
      return detector.detectFast(code);
    },
    accuracy: 'es5 check',
  },
  {
    name: 'fast-brake (es2015 only)',
    fn: async (code: string) => {
      const detector = new Detector();
      await detector.initialize(createESVersionPlugin('es2015'));
      return detector.detectFast(code);
    },
    accuracy: 'es2015 check',
  },
  {
    name: 'fast-brake (detect)',
    fn: async (code: string) => {
      const detector = new Detector();
      await detector.initialize(detectPlugin);
      return detector.detectFast(code);
    },
    accuracy: 'none',
  },
  {
    name: 'fast-brake (browserlist)',
    fn: async (code: string) => {
      const detector = new Detector();
      await detector.initialize(createBrowserlistPlugin('defaults'));
      return detector.detectFast(code);
    },
    accuracy: 'browser check',
  },
  {
    name: '@babel/parser',
    fn: (code: string) => babel.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] }),
    accuracy: 'parsed',
  },
  {
    name: 'acorn',
    fn: (code: string) => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }),
    accuracy: 'parsed',
  },
  {
    name: 'esprima',
    fn: (code: string) => esprima.parseScript(code),
    accuracy: 'parsed',
  },
  {
    name: 'espree',
    fn: (code: string) => espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }),
    accuracy: 'parsed',
  },
  {
    name: 'meriyah',
    fn: (code: string) => meriyahParse(code, { module: true, next: true }),
    accuracy: 'parsed',
  },
  {
    name: 'cherow',
    fn: (code: string) => cherowParse(code, { module: true, next: true }),
    accuracy: 'parsed',
  },
];

async function benchmark(fn: Function, code: string, iterations: number = 1000): Promise<number> {
  const start = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    try {
      await fn(code);
    } catch (e) {
      return -1;
    }
  }
  
  return (performance.now() - start) / iterations;
}

export async function runBenchmarks(options: { silent?: boolean } = {}): Promise<BenchmarkSet[]> {
  const { silent = false } = options;
  const results: BenchmarkSet[] = [];
  const testCases = loadTestCases();
  
  if (!silent) {
    console.log('🚀 Fast-Brake Benchmark Suite\n');
    console.log('Comparing fast-brake against popular JavaScript parsers\n');
  }
  
  for (const testCase of testCases) {
    if (!silent) {
      console.log(`\n📊 Testing: ${testCase.name} (${testCase.code.length} bytes)`);
      console.log('────────────────────────────────────────────────────────────');
    }
    
    const benchmarkResults: BenchmarkResult[] = [];
    let minTime = Infinity;
    
    for (const parser of parsers) {
      if (!silent) {
        process.stdout.write(`  Running ${parser.name}...`);
      }
      
      const time = await benchmark(parser.fn, testCase.code);
      
      if (time !== -1) {
        benchmarkResults.push({
          name: parser.name,
          time,
          opsPerSec: Math.round(1000 / time),
          relative: 0,
          accuracy: parser.accuracy,
        });
        
        if (time < minTime) {
          minTime = time;
        }
        
        if (!silent) {
          console.log(' ✓');
        }
      } else {
        benchmarkResults.push({
          name: parser.name,
          time: -1,
          opsPerSec: 0,
          relative: 0,
          accuracy: 'parse error',
        });
        
        if (!silent) {
          console.log(' ✗ (parse error)');
        }
      }
    }
    
    for (const result of benchmarkResults) {
      if (result.time !== -1) {
        result.relative = minTime / result.time;
      }
    }
    
    benchmarkResults.sort((a, b) => {
      if (a.time === -1) return 1;
      if (b.time === -1) return -1;
      return a.time - b.time;
    });
    
    results.push({
      name: testCase.name,
      fileSize: testCase.code.length,
      results: benchmarkResults,
    });
  }
  
  return results;
}

export function generateMarkdownTable(results: BenchmarkSet[]): string {
  let markdown = '';
  
  for (const set of results) {
    markdown += `### ${set.name}\n\n`;
    markdown += `File size: ${(set.fileSize / 1024).toFixed(1)} KB\n\n`;
    markdown += '| Parser | Time (ms) | Ops/sec | Relative | Accuracy |\n';
    markdown += '|--------|-----------|---------|----------|----------|\n';
    
    for (const result of set.results) {
      if (result.time === -1) {
        markdown += `| ${result.name} | - | - | - | ${result.accuracy} |\n`;
      } else {
        markdown += `| ${result.name} | ${result.time.toFixed(3)} | ${result.opsPerSec.toLocaleString()} | ${result.relative.toFixed(1)}x | ${result.accuracy} |\n`;
      }
    }
    
    markdown += '\n';
  }
  
  return markdown;
}

export async function updateRootReadme(benchmarkTable: string): Promise<void> {
  const readmePath = join(ROOT_DIR, 'README.md');
  const content = await readFile(readmePath, 'utf-8');
  
  const startMarker = '<!-- BENCHMARK_START -->';
  const endMarker = '<!-- BENCHMARK_END -->';
  
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    console.warn('⚠️  Benchmark markers not found in root README.md');
    console.log('   Add <!-- BENCHMARK_START --> and <!-- BENCHMARK_END --> markers');
    return;
  }
  
  const before = content.slice(0, startIndex + startMarker.length);
  const after = content.slice(endIndex);
  
  const newContent = `${before}\n\n${benchmarkTable}\n${after}`;
  
  await writeFile(readmePath, newContent);
  console.log('✅ Updated root README.md');
}

export async function updateSiteReadme(benchmarkTable: string): Promise<void> {
  const readmePath = join(ROOT_DIR, 'site/README.md');
  
  try {
    const content = await readFile(readmePath, 'utf-8');
    
    const startMarker = '<!-- BENCHMARK_START -->';
    const endMarker = '<!-- BENCHMARK_END -->';
    
    const startIndex = content.indexOf(startMarker);
    const endIndex = content.indexOf(endMarker);
    
    if (startIndex === -1 || endIndex === -1) {
      console.warn('⚠️  Benchmark markers not found in site/README.md');
      return;
    }
    
    const before = content.slice(0, startIndex + startMarker.length);
    const after = content.slice(endIndex);
    
    const newContent = `${before}\n\n${benchmarkTable}\n${after}`;
    
    await writeFile(readmePath, newContent);
    console.log('✅ Updated site/README.md');
  } catch (error) {
    console.log('ℹ️  Site README.md not found or not accessible');
  }
}

export async function updateSiteDocs(benchmarkData: BenchmarkSet[]): Promise<void> {
  const docsPath = join(ROOT_DIR, 'site/src/content/docs/benchmarks.md');
  
  try {
    const content = await readFile(docsPath, 'utf-8');
    
    const startMarker = '<!-- BENCHMARK_DATA_START -->';
    const endMarker = '<!-- BENCHMARK_DATA_END -->';
    
    const startIndex = content.indexOf(startMarker);
    const endIndex = content.indexOf(endMarker);
    
    if (startIndex === -1 || endIndex === -1) {
      console.warn('⚠️  Benchmark markers not found in site docs');
      return;
    }
    
    const before = content.slice(0, startIndex + startMarker.length);
    const after = content.slice(endIndex);
    
    const markdownTable = generateMarkdownTable(benchmarkData);
    const newContent = `${before}\n\n${markdownTable}\n${after}`;
    
    await writeFile(docsPath, newContent);
    console.log('✅ Updated site/src/content/docs/benchmarks.md');
  } catch (error) {
    console.log('ℹ️  Site docs benchmarks.md not found');
  }
}

export async function saveBenchmarkJson(benchmarkData: BenchmarkSet[]): Promise<void> {
  const jsonPath = join(ROOT_DIR, 'site/src/data/benchmarks.json');
  
  try {
    await writeFile(jsonPath, JSON.stringify(benchmarkData, null, 2));
    console.log('✅ Updated site/src/data/benchmarks.json');
  } catch (error) {
    console.log('ℹ️  Could not write benchmark JSON data');
  }
}

export async function updateDocs(): Promise<void> {
  console.log('📊 Fast-Brake Documentation Updater\n');
  
  try {
    const benchmarkData = await runBenchmarks({ silent: true });
    
    if (!benchmarkData || benchmarkData.length === 0) {
      console.error('❌ No benchmark data received');
      process.exit(1);
    }
    
    const markdownTable = generateMarkdownTable(benchmarkData);
    
    console.log('\n📝 Updating documentation files...\n');
    
    await updateRootReadme(markdownTable);
    await updateSiteReadme(markdownTable);
    await updateSiteDocs(benchmarkData);
    await saveBenchmarkJson(benchmarkData);
    
    console.log('\n✨ Documentation update complete!');
  } catch (error) {
    console.error('❌ Error updating documentation:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  updateDocs();
}