fn main() {
    // Build WASM
    if let Some((_, wasm_path)) = sails_rs::build_wasm() {
        // Generate IDL and embed it into WASM
        sails_rs::ClientBuilder::<::agent_trust_layer_app::Program>::from_wasm_path(&wasm_path)
            .build_idl();

        let program_name = wasm_path
            .file_name()
            .expect("wasm path has file name")
            .to_string_lossy()
            .split('.')
            .next()
            .expect("wasm file has stem")
            .to_string();
        let idl_path = wasm_path.with_file_name(program_name).with_extension("idl");
        let idl = std::fs::read_to_string(&idl_path).expect("read generated IDL");
        let patched = idl.replacen(
            "service AgentTrustLayer@",
            "@partial\nservice AgentTrustLayer@",
            1,
        );
        let patched = add_entry_ids(&patched);
        std::fs::write(&idl_path, patched).expect("write patched IDL");
    }
}

fn add_entry_ids(idl: &str) -> String {
    let mut output = String::new();
    let mut in_functions = false;
    let mut in_events = false;
    let mut next_entry_id = 0u16;
    let mut next_event_id = 0u16;

    for line in idl.lines() {
        let trimmed = line.trim_start();
        let leading_spaces = line.len() - trimmed.len();
        if trimmed == "events {" {
            in_events = true;
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if trimmed == "functions {" {
            in_functions = true;
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if in_events && trimmed == "}" {
            in_events = false;
        }
        if in_functions && trimmed == "}" {
            in_functions = false;
        }
        if in_events
            && leading_spaces == 8
            && !trimmed.starts_with('}')
            && (trimmed.ends_with('{') || trimmed.ends_with(','))
        {
            output.push_str("        @entry_id: ");
            output.push_str(&next_event_id.to_string());
            output.push('\n');
            next_event_id += 1;
        }
        if in_functions && leading_spaces == 8 && trimmed.contains('(') && trimmed.ends_with(';') {
            output.push_str("        @entry_id: ");
            output.push_str(&next_entry_id.to_string());
            output.push('\n');
            next_entry_id += 1;
        }
        output.push_str(line);
        output.push('\n');
    }

    output
}
