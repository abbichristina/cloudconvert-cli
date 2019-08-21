const
    ora = require('ora'),
    logSymbols = require('log-symbols'),
    fs = require('fs'),
    path = require('path');


module.exports = async (argv, taskData) => {


    const spinner = ora('Creating job').start();
    const cloudconvert = argv.cloudconvert;


    let jobData = {
        'tasks': {
            'process': taskData,
            'export': {
                'operation': 'export/url',
                'input': 'process'
            }
        }

    };

    if (argv.files) {

        jobData.tasks.process.input = [];

        argv.files.forEach((filename, index) => {
            jobData.tasks['upload-' + index] = {
                'operation': 'import/upload'
            };
            jobData.tasks.process.input.push('upload-' + index);
        });

    }


    let job = await cloudconvert.jobs.create(jobData);


    // wait for finished event
    cloudconvert.jobs.subscribeEvent(job.id, 'finished', async event => {

        job = await cloudconvert.jobs.get(job.id);

        // download output files
        for (const task of job.tasks.filter(task => task.operation === 'export/url')) {

            for (const file of task.result.files) {

                spinner.text = 'Downloading ' + file.filename;

                const writeStream = fs.createWriteStream(path.join(argv.outputdir || '.', file.filename));
                const response = await cloudconvert.axios(file.url, {
                    responseType: 'stream'
                });

                response.data.pipe(writeStream);

                await new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                });

            }

        }

        cloudconvert.socket.close();
        spinner.succeed('Done!');

        // print success messages
        for (const task of job.tasks.filter(task => task.message)) {
            console.log(logSymbols.info, 'Task `' + task.name + '`: ' + task.message)
        }


    });


    // log task errors
    cloudconvert.jobs.subscribeTaskEvent(job.id, 'failed', event => {
        console.error('\n' + logSymbols.error, 'Task `' + event.task.name + '` failed: ' + event.task.message + ' (Code: ' + event.task.code + ')')
    });


    // handle job failed
    cloudconvert.jobs.subscribeEvent(job.id, 'failed', event => {
        cloudconvert.socket.close();
        process.exitCode = 1;
        spinner.fail('Job failed!');
    });

    cloudconvert.socket.on('error', err => console.error(err));

    // upload files
    for (const [index, task] of job.tasks.filter(task => task.operation === 'import/upload').entries()) {
        spinner.text = 'Uploading ' + argv.files[index];
        await cloudconvert.tasks.upload(task, fs.createReadStream(argv.files[index]));
    }

    spinner.text = 'Processing';

};