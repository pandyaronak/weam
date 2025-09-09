const SOLUTION_CONFIGS = {
    'ai-doc-editor': {
        repoUrl: 'https://github.com/devweam-ai/ai-doc-editor.git',
        repoName: 'ai-doc-editor',
        imageName: 'ai-doc-editor-img',
        containerName: 'ai-doc-editor-container',
        port: '3002',
        branchName: 'main',
        installType: 'docker', // docker or docker-compose
        envFile: 'env.example'
    },
    // 'seo-content-gen': {
    //     repoUrl: 'https://github.com/devweam-ai/seo-content-gen.git',
    //     repoName: 'seo-content-gen',
    //     imageName: 'seo-content-gen-img',
    //     containerName: 'seo-content-gen-container',
    //     port: '3003',
    //     branchName: 'opensource-deployment',
    //     installType: 'docker-compose', // docker or docker-compose
    //     envFile: null, // No env file needed for docker-compose
    //     additionalPorts: ['9001', '9002', '9003'] // Additional ports for docker-compose services
    // },
    'followup': {
        repoUrl: 'https://github.com/devweam-ai/foloup.git',
        repoName: 'foloup',
        imageName: 'foloup-img',
        containerName: 'foloup-container',
        port: '4000',
        branchName: 'main',
        installType: 'docker-compose', // docker or docker-compose
        envFile: '.env.example', // Has .env.example file that needs to be converted to .env
        additionalPorts: [] // No additional ports specified
    }
};

module.exports = SOLUTION_CONFIGS;