import path from 'node:path';
import { $, Glob } from 'bun';

const __dirname = import.meta.dirname;
const packageDir = path.join(__dirname, '..');

const buildPackage = async () => {
  const packageJson = await Bun.file(path.join(packageDir, 'package.json')).json();
  const npmPackageName = packageJson.name;
  console.log(`\n📦 Building ${npmPackageName}...`);

  // Create build-specific tsconfig.json
  await Bun.write(
    path.join(packageDir, 'tsconfig.build.json'),
    JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          allowSyntheticDefaultImports: true,
          allowImportingTsExtensions: true,
          target: 'ESNext',
          declaration: true,
          esModuleInterop: true,
          inlineSourceMap: false,
          lib: ['ESNext'],
          listEmittedFiles: false,
          listFiles: false,
          moduleResolution: 'bundler',
          noFallthroughCasesInSwitch: true,
          pretty: true,
          resolveJsonModule: true,
          rootDir: '.',
          skipLibCheck: true,
          strict: true,
          traceResolution: false,
        },
        compileOnSave: false,
        exclude: ['node_modules', 'dist', '**/*.test.ts'],
        include: ['index.ts', 'src/**/*.ts'],
      },
      null,
      2,
    ),
  );

  // Create types-specific tsconfig
  await Bun.write(
    path.join(packageDir, 'tsconfig.types.json'),
    JSON.stringify(
      {
        extends: './tsconfig.build.json',
        compilerOptions: {
          declaration: true,
          outDir: 'dist/types',
          emitDeclarationOnly: true,
          declarationDir: 'dist/types',
        },
      },
      null,
      2,
    ),
  );

  // TypeScript compilation for type declarations
  const runTsc = async (tsconfig: string) => {
    const { stdout, stderr, exitCode } = await $`bunx --bun tsc -p ${tsconfig}`
      .cwd(packageDir)
      .nothrow();

    if (exitCode !== 0) {
      console.error(stderr.toString());
      console.log(stdout.toString());
      return false;
    }
    const output = stdout.toString();
    if (output.trim() !== '') {
      console.log(output);
    }
    console.log(`  ✅ Type declarations generated`);
    return true;
  };

  // Build with Bun for both formats
  const bunBuildFile = async (src: string, relativeDir: string, type: 'cjs' | 'mjs') => {
    const result = await Bun.build({
      entrypoints: [src],
      outdir: path.join(packageDir, 'dist', type, relativeDir),
      sourcemap: 'external',
      format: type === 'mjs' ? 'esm' : 'cjs',
      packages: 'external',
      external: ['*'],
      naming: `[name].${type}`,
      target: 'node',
      plugins: [
        {
          name: 'extension-plugin',
          setup(build) {
            build.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, async (args) => {
              let content = await Bun.file(args.path).text();
              const extension = type;

              // Replace relative imports with extension (handles both extensionless and .ts/.tsx imports)
              content = content.replace(
                /((?:im|ex)port\s[\w{}/*\s,]+from\s['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
                `$1.${extension}`,
              );

              // Replace dynamic imports
              content = content.replace(
                /(import\(['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
                `$1.${extension}`,
              );

              return {
                contents: content,
                loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
              };
            });
          },
        },
      ],
    });

    result.logs.forEach((log) => {
      console.log(`  [${log.level}] ${log.message}`);
    });

    if (!result.success) {
      return false;
    }

    return true;
  };

  // Clean dist directory
  await $`rm -rf dist`.cwd(packageDir).nothrow();

  // Build root index.ts
  const buildRootIndex = async (type: 'cjs' | 'mjs') => {
    return bunBuildFile(path.join(packageDir, 'index.ts'), '', type);
  };

  // Recursive build function for all .ts files in src
  const runBunBundleRec = async (type: 'cjs' | 'mjs') => {
    const tsGlob = new Glob('**/*.ts');
    let allSuccess = true;
    for await (const file of tsGlob.scan({
      cwd: path.join(packageDir, 'src'),
    })) {
      // Skip test files and declaration files
      if (file.endsWith('.test.ts') || file.endsWith('.d.ts')) {
        continue;
      }
      // Get the directory part of the relative path to preserve folder structure
      const relativeDir = path.dirname(file);
      const success = await bunBuildFile(path.join(packageDir, 'src', file), path.join('src', relativeDir), type);
      if (!success) {
        allSuccess = false;
      }
    }
    return allSuccess;
  };

  // Build all formats in parallel
  const success = (
    await Promise.all([
      buildRootIndex('mjs'),
      buildRootIndex('cjs'),
      runBunBundleRec('mjs'),
      runBunBundleRec('cjs'),
      runTsc('tsconfig.types.json'),
    ])
  ).every((s) => s);

  if (!success) {
    throw new Error(`Failed to build ${npmPackageName}`);
  }

  console.log(`  ✅ CJS bundle created`);
  console.log(`  ✅ MJS bundle created`);

  // Create package.json in dist folders
  const version = packageJson.version;

  for (const [folder, type] of [
    ['dist/cjs', 'commonjs'],
    ['dist/mjs', 'module'],
  ] as const) {
    await Bun.write(
      path.join(packageDir, folder, 'package.json'),
      JSON.stringify(
        {
          name: packageJson.name,
          version,
          type,
        },
        null,
        2,
      ),
    );
  }

  // Update main package.json for publishing
  const publishPackageJson = { ...packageJson };

  // Remove dev-only fields
  delete publishPackageJson.devDependencies;

  // Set module type and exports
  delete publishPackageJson.type;
  delete publishPackageJson.module;
  publishPackageJson.main = './dist/cjs/index.cjs';
  publishPackageJson.module = './dist/mjs/index.mjs';
  publishPackageJson.types = './dist/types/index.d.ts';

  publishPackageJson.exports = {
    '.': {
      types: './dist/types/index.d.ts',
      require: './dist/cjs/index.cjs',
      import: './dist/mjs/index.mjs',
    },
  };

  publishPackageJson.publishConfig = {
    access: 'public',
  };
  publishPackageJson.files = ['dist', 'README.md'];

  // Write the publish-ready package.json
  await Bun.write(
    path.join(packageDir, 'package.json'),
    JSON.stringify(publishPackageJson, null, 2),
  );

  console.log(`  ✅ package.json updated for publishing`);

  console.log(`✨ Finished building ${npmPackageName} v${version}`);
};

// Main build process
const main = async () => {
  console.log('🚀 Building package for npm publishing...');
  console.log('============================================================\n');

  try {
    await buildPackage();
  } catch (error) {
    console.error(`❌ Build failed:`, error);
    process.exit(1);
  }

  console.log('\n✨ Package built successfully!');
};

main().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
