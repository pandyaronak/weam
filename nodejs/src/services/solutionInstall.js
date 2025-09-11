const { handleError } = require('../utils/helper');
const { spawn } = require('child_process');
const fs = require('fs');
const SOLUTION_CONFIGS = require('../config/solutionconfig');

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Detects Docker Compose and returns appropriate command
 * @returns {Promise<{command: string, needsInstall: boolean}>}
 */
async function detectDockerCompose() {
    try {
        // First check for docker-compose command (V1 or installed V2)
        try {
            await runBashWithProgress('docker-compose --version', null, 'Checking for docker-compose');
            console.log('✅ docker-compose command found');
            return {
                command: 'docker-compose',
                needsInstall: false
            };
        } catch (error) {
            console.log('❌ docker-compose not found, will install');
            return {
                command: 'docker-compose',
                needsInstall: true
            };
        }
    } catch (error) {
        console.error('Error detecting Docker Compose:', error);
        return {
            command: 'docker-compose',
            needsInstall: true
        };
    }
}

/**
 * Installs Docker Compose V2 if needed
 * @param {object} res - Express response object
 * @returns {Promise<void>}
 */
async function installDockerComposeV2(res) {
    console.log('📦 Installing Docker Compose V2...');
    
    try {
        // First check if docker-compose is already available
        await runBashWithOutput('which docker-compose');
        console.log('✅ Docker Compose already available');
        return;
    } catch (error) {
        console.log('Docker Compose not found, proceeding with installation...');
    }
    
    const installCommand = `wget -O /usr/local/bin/docker-compose "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" && chmod +x /usr/local/bin/docker-compose`;
    
    try {
        await runBashWithOutput(installCommand);
        console.log('✅ Docker Compose V2 installed successfully');
        
        // Verify installation
        await runBashWithOutput('docker-compose --version');
    } catch (error) {
        console.error('❌ Failed to install Docker Compose V2:', error);
        // Don't throw error, continue with fallback approach
        console.log('⚠️ Continuing with fallback approach...');
    }
}

/**
 * Executes bash commands with console output and progress updates
 * @param {string} command - The bash command to execute
 * @param {object} res - Express response object for SSE updates
 * @param {string} progressMessage - Optional progress message to log
 * @param {number} currentStep - Current step number
 * @param {number} totalSteps - Total number of steps
 * @returns {Promise} - Resolves when command completes successfully
 */
function runBashWithProgress(command, res, progressMessage, currentStep = 1, totalSteps = 5) {
    return new Promise((resolve, reject) => {
        // Log progress message
        if (progressMessage) {
            console.log(progressMessage);
        }

        // Send progress update at start of step (only for important steps, not Docker build)
        if (res && res.write && (currentStep === 1 || currentStep === 2 || currentStep === 5)) {
            res.write(`data: ${JSON.stringify({ 
                type: 'progress', 
                message: progressMessage || 'Executing command...',
                step: currentStep,
                totalSteps: totalSteps
            })}\n\n`);
        }

        const child = spawn('sh', ['-c', command], {});
        
        child.stdout.on('data', (data) => {
            const output = String(data).trim();
            console.log(output);
            
            // Only send output to frontend for non-Docker build steps
            if (res && res.write && currentStep !== 4) {
                res.write(`data: ${JSON.stringify({ 
                    type: 'output', 
                    message: output
                })}\n\n`);
            }
        });
        
        child.stderr.on('data', (data) => {
            const error = String(data).trim();
            console.error(error);
            
            // Only send error output to frontend for non-Docker build steps
            if (res && res.write && currentStep !== 4) {
                res.write(`data: ${JSON.stringify({ 
                    type: 'error_output', 
                    message: error
                })}\n\n`);
            }
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                // Don't send step completion message - only send final success/error
                resolve(code);
            } else {
                // Send step failure (only for non-Docker build steps)
                if (res && res.write && currentStep !== 4) {
                    res.write(`data: ${JSON.stringify({ 
                        type: 'error', 
                        message: `Command failed: ${command}`,
                        step: currentStep,
                        totalSteps: totalSteps
                    })}\n\n`);
                }
                reject(new Error(`Command failed: ${command}`));
            }
        });
    });
}

/**
 * Executes bash commands and returns output
 * @param {string} command - The bash command to execute
 * @returns {Promise<string>} - Resolves with command output
 */
function runBashWithOutput(command) {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', command], {});
        let output = '';
        let errorOutput = '';
        
        child.stdout.on('data', (data) => {
            output += String(data);
        });
        
        child.stderr.on('data', (data) => {
            errorOutput += String(data);
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve(output.trim());
            } else {
                reject(new Error(`Command failed: ${command}. Error: ${errorOutput}`));
            }
        });
    });
}

/**
 * Executes bash commands for Docker build without sending progress updates
 * @param {string} command - The bash command to execute
 * @param {object} res - Express response object for SSE updates
 * @param {string} progressMessage - Optional progress message to log
 * @param {number} currentStep - Current step number
 * @param {number} totalSteps - Total number of steps
 * @returns {Promise} - Resolves when command completes successfully
 */
function runBashForDockerBuild(command, res, progressMessage, currentStep = 1, totalSteps = 5) {
    return new Promise((resolve, reject) => {
        // Log progress message
        if (progressMessage) {
            console.log(progressMessage);
        }

        // Don't send any progress updates for Docker build to avoid connection issues

        const child = spawn('sh', ['-c', command], {});
        
        child.stdout.on('data', (data) => {
            const output = String(data).trim();
            console.log(output);
            
            // Don't send output to frontend during Docker build to avoid connection issues
        });
        
        child.stderr.on('data', (data) => {
            const error = String(data).trim();
            console.error(error);
            
            // Don't send error output to frontend during Docker build to avoid connection issues
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                // Don't send completion message for Docker build
                resolve(code);
            } else {
                // Don't send error message for Docker build to avoid connection issues
                reject(new Error(`Command failed: ${command}`));
            }
        });
    });
}

/**
 * Merges environment variables from root and local .env files
 * Creates Docker build arguments from merged variables
 * @param {string} rootEnvPath - Path to root .env file
 * @param {string} localEnvPath - Path to local .env file
 * @returns {string} - Space-separated Docker build arguments
 */
function mergeEnvAndCreateBuildArgs(rootEnvPath, localEnvPath) {
    try {
        // Read root .env file
        let rootEnvVars = {};
        if (fs.existsSync(rootEnvPath)) {
            const rootContent = fs.readFileSync(rootEnvPath, 'utf8');
            rootContent.split('\n').forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    rootEnvVars[key.trim()] = valueParts.join('=').trim();
                }
            });
        }

        // Read local .env file
        let localEnvVars = {};
        if (fs.existsSync(localEnvPath)) {
            const localContent = fs.readFileSync(localEnvPath, 'utf8');
            localContent.split('\n').forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    localEnvVars[key.trim()] = valueParts.join('=').trim();
                }
            });
        }

        // Merge: start with local, add missing from root
        const mergedEnvVars = { ...localEnvVars };
        Object.keys(rootEnvVars).forEach(varName => {
            if (rootEnvVars[varName] && !mergedEnvVars[varName]) {
                mergedEnvVars[varName] = rootEnvVars[varName];
            }
        });

        // Create Docker build args
        const buildArgs = [];
        Object.entries(mergedEnvVars).forEach(([key, value]) => {
            const escapedValue = value.replace(/"/g, '\\"');
            buildArgs.push(`--build-arg ${key}="${escapedValue}"`);
        });

        console.log(`✅ Merged ${Object.keys(mergedEnvVars).length} environment variables`);
        return buildArgs.join(' ');
    } catch (error) {
        console.error('❌ Error merging environment files:', error);
        throw error;
    }
}

/**
 * Merges environment variables from root and local .env files
 * Writes merged variables to a .env file
 * @param {string} rootEnvPath - Path to root .env file
 * @param {string} localEnvPath - Path to local .env file
 * @param {string} outputPath - Path where to write the merged .env file
 * @returns {object} - Merged environment variables object
 */
function mergeEnvAndWriteToFile(rootEnvPath, localEnvPath, outputPath) {
    try {
        // Read root .env file
        let rootEnvVars = {};
        if (fs.existsSync(rootEnvPath)) {
            const rootContent = fs.readFileSync(rootEnvPath, 'utf8');
            rootContent.split('\n').forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    rootEnvVars[key.trim()] = valueParts.join('=').trim();
                }
            });
        }

        // Read local .env file
        let localEnvVars = {};
        if (fs.existsSync(localEnvPath)) {
            const localContent = fs.readFileSync(localEnvPath, 'utf8');
            localContent.split('\n').forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    localEnvVars[key.trim()] = valueParts.join('=').trim();
                }
            });
        }

        // Merge: start with local, add missing from root
        const mergedEnvVars = { ...localEnvVars };
        Object.keys(rootEnvVars).forEach(varName => {
            if (rootEnvVars[varName] && !mergedEnvVars[varName]) {
                mergedEnvVars[varName] = rootEnvVars[varName];
            }
        });

        // Write merged environment variables to file
        const envContent = Object.entries(mergedEnvVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        fs.writeFileSync(outputPath, envContent);

        console.log(`✅ Merged ${Object.keys(mergedEnvVars).length} environment variables and wrote to ${outputPath}`);
        return mergedEnvVars;
    } catch (error) {
        console.error('❌ Error merging environment files:', error);
        throw error;
    }
}

/**
 * Common function to merge environment variables for all service types
 * @param {string} rootEnvPath - Path to root .env file
 * @param {string} localEnvPath - Path to local .env file
 * @param {string} installType - Type of installation (docker or docker-compose)
 * @param {string} repoPath - Path to repository
 * @returns {Promise<object>} - Object containing buildArgs and tempEnvPath
 */
async function mergeEnvironmentVariables(rootEnvPath, localEnvPath, installType, repoPath) {
    try {
        if (installType === 'docker-compose') {
            // For docker-compose, create a temporary merged .env file
            const tempEnvPath = `${repoPath}/.env.temp`;
            const mergedEnvVars = mergeEnvAndWriteToFile(rootEnvPath, localEnvPath, tempEnvPath);
            console.log(`✅ Environment variables merged into temporary .env file`);
            return { buildArgs: '', tempEnvPath };
        } else {
            // For regular docker services, use build args
            const buildArgs = mergeEnvAndCreateBuildArgs(rootEnvPath, localEnvPath) || '';
            console.log('📋 Build args generated:', buildArgs);
            return { buildArgs, tempEnvPath: '' };
        }
    } catch (error) {
        console.error('❌ Error merging environment variables:', error);
        console.log('⚠️ Continuing with existing .env file...');
        return { buildArgs: '', tempEnvPath: localEnvPath }; // Fallback to original .env
    }
}

/**
 * Common function to handle docker-compose environment file management
 * @param {string} tempEnvPath - Path to temporary .env file
 * @param {string} localEnvPath - Path to local .env file
 * @param {function} composeCommand - Function to execute docker-compose command
 * @param {object} res - Express response object
 * @returns {Promise<void>}
 */
async function handleDockerComposeWithEnvMerge(tempEnvPath, localEnvPath, composeCommand, res) {
    let originalEnvBackup = '';
    try {
        // For docker-compose, use temporary merged .env file
        if (tempEnvPath && tempEnvPath !== localEnvPath) {
            // Backup original .env file
            if (fs.existsSync(localEnvPath)) {
                originalEnvBackup = `${localEnvPath}.backup`;
                await runBashWithOutput(`cp ${localEnvPath} ${originalEnvBackup}`);
            }
            
            // Replace .env with merged version
            await runBashWithOutput(`cp ${tempEnvPath} ${localEnvPath}`);
        }
        
        // Execute the docker-compose command
        await composeCommand();
        
    } finally {
        // Restore original .env file and clean up
        if (tempEnvPath && tempEnvPath !== localEnvPath) {
            try {
                if (originalEnvBackup && fs.existsSync(originalEnvBackup)) {
                    await runBashWithOutput(`cp ${originalEnvBackup} ${localEnvPath}`);
                    await runBashWithOutput(`rm -f ${originalEnvBackup}`);
                }
                await runBashWithOutput(`rm -f ${tempEnvPath}`);
            } catch (error) {
                console.log('⚠️ Could not clean up temporary files:', error.message);
            }
        }
    }
}


// ============================================================================
// SOLUTION CONFIGURATIONS
// ============================================================================
// Each solution configuration contains all necessary information for installation
// Add new solutions here with their specific requirements

// ============================================================================
// SERVICE INSTALLATION BLOCKS
// ============================================================================

/**
 * DOCKER SERVICE BLOCK
 * Handles installation for services that use simple Docker (single container)
 * Examples: ai-doc-editor, simple Node.js apps, etc.
 */
async function installDockerService(config, repoPath, res, totalSteps) {
    const networkName = 'weamai_app-network';
    
    // Step 3: Setup environment (Docker only)
    console.log('⚙️ Setting up environment configuration...');
    await runBashWithProgress(`cp ${repoPath}/${config.envFile} ${repoPath}/.env`, res, 'Environment configuration completed', 3, totalSteps);

    // Merge environment variables and create build args
    const rootEnvPath = '/workspace/.env';
    const localEnvPath = `${repoPath}/.env`;
    const buildArgs = mergeEnvAndCreateBuildArgs(rootEnvPath, localEnvPath);
    
    // Step 4: Build Docker image
    console.log('🐳 Building Docker image (this may take several minutes)...');
    const buildCmd = `docker build -t ${config.imageName} ${buildArgs} ${repoPath}`;
    await runBashForDockerBuild(buildCmd, res, 'Docker image built successfully', 4, totalSteps);

    // Step 5: Run container
    console.log('🚀 Starting Docker container...');
    const runCmd = `docker rm -f ${config.containerName} || true && docker run -d --name ${config.containerName} --network ${networkName} -p ${config.port}:${config.port} ${config.imageName}`;
    await runBashWithProgress(runCmd, res, 'Container started successfully', 5, totalSteps);
}

/**
 * Detects repository structure and available Docker files
 * @param {string} repoPath - Path to the repository
 * @param {object} res - Express response object
 * @returns {Promise<object>} - Repository structure information
 */
async function detectRepositoryStructure(repoPath, res) {
    const structure = {
        hasDockerCompose: false,
        hasRootDockerfile: false,
        subdirectories: [],
        dockerfiles: [],
        composeFile: null
    };

    try {
        console.log('🔍 Analyzing repository structure...');
        
        // Check for docker-compose files
        const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
        for (const file of composeFiles) {
            try {
                await runBashWithOutput(`test -f ${repoPath}/${file}`);
                structure.hasDockerCompose = true;
                structure.composeFile = file;
                console.log(`✅ Found Docker Compose file: ${file}`);
                break;
            } catch (error) {
                // File doesn't exist, continue checking
            }
        }

        // Check for root Dockerfile
        try {
            await runBashWithOutput(`test -f ${repoPath}/Dockerfile`);
            structure.hasRootDockerfile = true;
            console.log('✅ Found root Dockerfile');
        } catch (error) {
            // No root Dockerfile
        }

        // Find all Dockerfiles in subdirectories using a more efficient approach
        try {
            const findCmd = `find ${repoPath} -name "Dockerfile" -type f -not -path "${repoPath}/Dockerfile"`;
            const dockerfileOutput = await runBashWithOutput(findCmd);
            if (dockerfileOutput) {
                const dockerfilePaths = dockerfileOutput.split('\n').filter(path => path.trim());
                for (const path of dockerfilePaths) {
                    // Extract directory name from path
                    const relativePath = path.replace(`${repoPath}/`, '');
                    const dirName = relativePath.split('/')[0];
                    if (dirName && !structure.dockerfiles.includes(dirName)) {
                        structure.dockerfiles.push(dirName);
                        console.log(`✅ Found Dockerfile in: ${dirName}`);
                    }
                }
            }
        } catch (error) {
            // No subdirectory Dockerfiles found
        }

        // Get list of subdirectories that might contain services
        const commonServiceDirs = ['frontend', 'backend', 'node', 'python', 'api', 'web', 'app'];
        for (const dir of commonServiceDirs) {
            try {
                await runBashWithOutput(`test -d ${repoPath}/${dir}`);
                if (!structure.subdirectories.includes(dir)) {
                    structure.subdirectories.push(dir);
                }
            } catch (error) {
                // Directory doesn't exist
            }
        }

        console.log('📋 Repository structure detected:', JSON.stringify(structure, null, 2));
        return structure;
    } catch (error) {
        console.error('❌ Error detecting repository structure:', error);
        return structure;
    }
}

/**
 * DOCKER-COMPOSE SERVICE BLOCK
 * Handles installation for services that use Docker Compose (multiple containers)
 * Auto-detects Docker Compose version and uses appropriate commands
 * Dynamically handles different repository structures
 * Examples: seo-content-gen, foloup, microservices, etc.
 */
async function installDockerComposeService(config, repoPath, res, totalSteps) {
    const networkName = 'weamai_app-network';
    
    // Step 3: Setup environment files
    console.log('⚙️ Setting up environment configuration files...');
    await runBashWithProgress(`find ${repoPath} -name ".env.example" -exec sh -c 'cp "$1" "$(dirname "$1")/.env"' _ {} \\;`, res, 'Environment files setup completed', 3, totalSteps);
    
    // Special handling for foloup - ensure basePath starts with /
    if (config.repoName === 'foloup') {
        console.log('🔧 Fixing Next.js configuration for foloup...');
        const localEnvPath = `${repoPath}/.env`;
        if (!fs.existsSync(localEnvPath)) {
            const basicEnvContent = `NEXT_PUBLIC_API_BASE_PATH=/
NODE_ENV=production`;
            fs.writeFileSync(localEnvPath, basicEnvContent);
        }
    }
    
    // Merge environment variables for all services (common approach)
    console.log('🔧 Preparing environment variables for Docker build...');
    const rootEnvPath = '/workspace/.env';
    const localEnvPath = `${repoPath}/.env`;
    
    // Use common environment merging function for all services
    const envMergeResult = await mergeEnvironmentVariables(rootEnvPath, localEnvPath, config.installType, repoPath);
    const { buildArgs, tempEnvPath } = envMergeResult;

    // Step 4: Detect repository structure
    console.log('🔍 Detecting repository structure...');
    const repoStructure = await detectRepositoryStructure(repoPath, res);

    // Step 5: Detect and install Docker Compose if needed
    console.log('🔍 Detecting Docker Compose...');
    let composeInfo;
    try {
        composeInfo = await detectDockerCompose();
    } catch (error) {
        console.error('❌ Error detecting Docker Compose:', error);
        composeInfo = {
            command: 'docker-compose',
            needsInstall: true
        };
    }
    
    if (composeInfo.needsInstall) {
        try {
            await installDockerComposeV2(res);
        } catch (error) {
            console.error('❌ Error installing Docker Compose:', error);
            console.log('⚠️ Continuing with fallback approach...');
        }
    }

    // Step 6: Install based on repository structure
    console.log(`🐳 Building and starting services...`);
    
    try {
        // First, stop any existing containers that might be using the ports
        if (repoStructure.hasDockerCompose) {
            const downCmd = `cd ${repoPath} && ${composeInfo.command} down`;
            await runBashWithOutput(downCmd);
        }
        
        // Check and free up ports that might be in use
        if (config.additionalPorts) {
            for (const port of config.additionalPorts) {
                await runBashWithOutput(`docker ps -q --filter "publish=${port}" | xargs -r docker stop`);
            }
        }

        // Primary approach: Use docker-compose if available
        if (repoStructure.hasDockerCompose) {
            console.log(`📦 Using Docker Compose (${repoStructure.composeFile})...`);
            
            // Use common function to handle docker-compose with environment merging
            await handleDockerComposeWithEnvMerge(tempEnvPath, localEnvPath, async () => {
                const composeCmd = `cd ${repoPath} && ${composeInfo.command} up -d --build`;
                await runBashForDockerBuild(composeCmd, res, `Docker Compose services started successfully`, 4, totalSteps);
            }, res);
        } 
        // Fallback 1: Use root Dockerfile if available
        else if (repoStructure.hasRootDockerfile) {
            console.log('📦 Using root Dockerfile...');
            const buildCmd = `docker build -t ${config.imageName} ${buildArgs} ${repoPath}`;
            await runBashForDockerBuild(buildCmd, res, 'Docker image built successfully', 4, totalSteps);
            
            const runCmd = `docker rm -f ${config.containerName} || true && docker run -d --name ${config.containerName} --network ${networkName} -p ${config.port}:${config.port} ${config.imageName}`;
            await runBashWithProgress(runCmd, res, 'Container started successfully', 5, totalSteps);
        }
        // Fallback 2: Use subdirectory Dockerfiles
        else if (repoStructure.dockerfiles.length > 0) {
            console.log(`📦 Using subdirectory Dockerfiles: ${repoStructure.dockerfiles.join(', ')}`);
            
            // Build each service
            for (const serviceDir of repoStructure.dockerfiles) {
                const serviceImageName = `${config.imageName}-${serviceDir}`;
                const buildCmd = `cd ${repoPath}/${serviceDir} && docker build -t ${serviceImageName} ${buildArgs} .`;
                await runBashForDockerBuild(buildCmd, res, `${serviceDir} Docker image built successfully`, 4, totalSteps);
            }
            
            // Run the main service (prioritize frontend, then first available)
            let mainService = repoStructure.dockerfiles.find(dir => dir === 'frontend') || repoStructure.dockerfiles[0];
            const mainImageName = `${config.imageName}-${mainService}`;
            const runCmd = `docker rm -f ${config.containerName} || true && docker run -d --name ${config.containerName} --network ${networkName} -p ${config.port}:${config.port} ${mainImageName}`;
            await runBashWithProgress(runCmd, res, 'Main container started successfully', 5, totalSteps);
        }
        // Fallback 3: Try to find any Dockerfile and build it
        else {
            console.log('🔍 Searching for any available Dockerfile...');
            
            try {
                // Find any Dockerfile in the repository
                const findCmd = `find ${repoPath} -name "Dockerfile" -type f | head -1`;
                const dockerfilePath = await runBashWithOutput(findCmd);
                
                if (dockerfilePath) {
                    const dockerfileDir = dockerfilePath.replace('/Dockerfile', '');
                    console.log(`📦 Found Dockerfile at: ${dockerfileDir}`);
                    
                    const buildCmd = `cd ${dockerfileDir} && docker build -t ${config.imageName} ${buildArgs} .`;
                    await runBashForDockerBuild(buildCmd, res, 'Docker image built successfully', 4, totalSteps);
                    
                    const runCmd = `docker rm -f ${config.containerName} || true && docker run -d --name ${config.containerName} --network ${networkName} -p ${config.port}:${config.port} ${config.imageName}`;
                    await runBashWithProgress(runCmd, res, 'Container started successfully', 5, totalSteps);
                } else {
                    throw new Error('No Dockerfile found in repository');
                }
            } catch (error) {
                console.error('❌ No suitable Docker configuration found:', error.message);
                throw new Error(`No suitable Docker configuration found in repository. Please ensure the repository contains either a docker-compose.yml file or at least one Dockerfile.`);
            }
        }
        
    } catch (error) {
        console.error('❌ All installation approaches failed:', error);
        throw new Error(`Installation failed: ${error.message}`);
    }
}

// ============================================================================
// MAIN INSTALLATION FUNCTION
// ============================================================================

const installWithProgress = async (req, res) => {
    try {
        // Get solution type from request body
        const solutionType = req.body?.solutionType;
        
        // Log the received solution type for debugging
        console.log('🔍 Received solution type:', solutionType);
        console.log('📋 Available solutions:', Object.keys(SOLUTION_CONFIGS));
        console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
        
        if (!solutionType) {
            throw new Error('Solution type is required. Please provide solutionType in request body.');
        }
        
        const config = SOLUTION_CONFIGS[solutionType];
        
        if (!config) {
            throw new Error(`Unknown solution type: ${solutionType}. Available solutions: ${Object.keys(SOLUTION_CONFIGS).join(', ')}`);
        }
        
        console.log(`✅ Installing solution: ${solutionType} (${config.installType})`);

        const repoPath = `/workspace/${config.repoName}`;
        const totalSteps = 5; // All services have 5 steps

        // Step 1: Clean up existing repository
        console.log('🧹 Cleaning up existing repository...');
        await runBashWithProgress(`rm -rf ${repoPath}`, res, 'Repository cleanup completed', 1, totalSteps);

        // Step 2: Clone repository
        console.log('📥 Cloning repository from GitHub...');
        await runBashWithProgress(`git clone -b ${config.branchName} ${config.repoUrl} ${repoPath}`, res, 'Repository cloned successfully', 2, totalSteps);

        // Step 3-5: Install based on service type
        if (config.installType === 'docker') {
            await installDockerService(config, repoPath, res, totalSteps);
        } else if (config.installType === 'docker-compose') {
            await installDockerComposeService(config, repoPath, res, totalSteps);
        } else {
            throw new Error(`Unsupported installation type: ${config.installType}`);
        }

        // Final success message
        console.log(`✅ Installation completed successfully! Your ${config.repoName} solution is now running at http://localhost:${config.port}`);
        
        // Send final success message to frontend
        if (res && res.write) {
            res.write(`data: ${JSON.stringify({ 
                type: 'success', 
                message: `Installation completed successfully! Your ${config.repoName} solution is now running at http://localhost:${config.port}`,
                url: `http://localhost:${config.port}`,
                step: totalSteps,
                totalSteps: totalSteps,
                finish: true
            })}\n\n`);
        }
        
        return { success: true, port: config.port, solutionType };
    } catch (error) {
        console.error(`❌ Installation failed: ${error.message}`);
        
        // Send error message to frontend
        if (res && res.write) {
            res.write(`data: ${JSON.stringify({ 
                type: 'error', 
                message: `Installation failed: ${error.message}`,
                error: error.message,
                finish: true
            })}\n\n`);
        }
        
        handleError(error, 'Error - solutionInstallWithProgress');
        throw error;
    }
}

module.exports = {
    installWithProgress,
}