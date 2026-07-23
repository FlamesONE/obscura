use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=js/bootstrap");
    println!("cargo:rerun-if-changed=build.rs");

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let snapshot_path = out_dir.join("OBSCURA_SNAPSHOT.bin");

    // bootstrap.js is split into ordered section files under js/bootstrap/
    // (00_core.js, 10_dom_node.js, ...). They are concatenated in filename order
    // and executed as a single classic script — byte-identical to the former
    // monolith, so the V8 snapshot (and every fingerprint) is unchanged.
    let bootstrap_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("js/bootstrap");
    let mut section_files: Vec<PathBuf> = std::fs::read_dir(&bootstrap_dir)
        .expect("js/bootstrap must exist")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("js"))
        .collect();
    section_files.sort();
    assert!(!section_files.is_empty(), "js/bootstrap has no .js sections");

    let mut bootstrap_js = String::new();
    for f in &section_files {
        println!("cargo:rerun-if-changed={}", f.display());
        bootstrap_js.push_str(&std::fs::read_to_string(f).expect("read bootstrap section"));
    }
    let bootstrap_js = bootstrap_js;

    let output = deno_core::snapshot::create_snapshot(
        deno_core::snapshot::CreateSnapshotOptions {
            cargo_manifest_dir: env!("CARGO_MANIFEST_DIR"),
            startup_snapshot: None,
            skip_op_registration: true,
            extensions: vec![],
            extension_transpiler: None,
            with_runtime_cb: Some(Box::new(move |runtime| {
                runtime
                    .execute_script("<obscura:bootstrap>", bootstrap_js.to_string())
                    .expect("bootstrap.js should not fail during snapshot creation");
            })),
        },
        None,
    )
    .expect("Failed to create V8 snapshot");

    std::fs::write(&snapshot_path, &*output.output).expect("Failed to write snapshot");
    println!(
        "cargo:rustc-env=OBSCURA_SNAPSHOT_PATH={}",
        snapshot_path.display()
    );

    for file in &output.files_loaded_during_snapshot {
        println!("cargo:rerun-if-changed={}", file.display());
    }
}
